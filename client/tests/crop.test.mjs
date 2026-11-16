import { test } from "node:test";
import assert from "node:assert/strict";
import { clampRect, dragRect, fitRatio, hitHandle } from "../dist/app/crop.js";

const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H && r.w > 0 && r.h > 0;

test("clampRect keeps the rectangle inside the image", () => {
    assert.deepEqual(clampRect({ x: -50, y: 900, w: 300, h: 300 }, 1000, 1000), { x: 0, y: 700, w: 300, h: 300 });
    assert.deepEqual(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, 1000, 800), { x: 0, y: 0, w: 1000, h: 800 });
    assert.equal(clampRect({ x: 10, y: 10, w: 1, h: 1 }, 1000, 800).w, 32); // minimum size
});

test("fitRatio: largest centred rectangle of that ratio", () => {
    assert.deepEqual(fitRatio({ x: 0, y: 0, w: 1000, h: 1000 }, 1.5), { x: 0, y: 167, w: 1000, h: 667 });
    assert.deepEqual(fitRatio({ x: 0, y: 0, w: 1000, h: 400 }, 1), { x: 300, y: 0, w: 400, h: 400 });
    assert.deepEqual(fitRatio({ x: 100, y: 100, w: 300, h: 200 }, 1.5), { x: 100, y: 100, w: 300, h: 200 });
});

test("move is clamped", () => {
    const s = { x: 100, y: 100, w: 300, h: 200 };
    assert.deepEqual(dragRect(s, "move", 50, -30, null, 1000, 800), { x: 150, y: 70, w: 300, h: 200 });
    assert.deepEqual(dragRect(s, "move", -5000, 5000, 1.5, 1000, 800), { x: 0, y: 600, w: 300, h: 200 });
});

test("free resize holds the opposite edges", () => {
    const s = { x: 100, y: 100, w: 300, h: 200 };
    assert.deepEqual(dragRect(s, "e", 100, 77, null, 1000, 800), { x: 100, y: 100, w: 400, h: 200 });
    assert.deepEqual(dragRect(s, "n", 5, -1000, null, 1000, 800), { x: 100, y: 0, w: 300, h: 300 });
    assert.deepEqual(dragRect(s, "sw", -1000, 1000, null, 1000, 800), { x: 0, y: 100, w: 400, h: 700 });
    // cannot be made smaller than the minimum, nor cross the opposite edge
    const t = dragRect(s, "w", 5000, 0, null, 1000, 800);
    assert.equal(t.x + t.w, 400);
    assert.equal(t.w, 32);
});

test("locked ratio: a corner holds the opposite corner and keeps the ratio", () => {
    const s = { x: 100, y: 100, w: 300, h: 200 };
    const se = dragRect(s, "se", 60, 0, 1.5, 1000, 800);
    assert.deepEqual(se, { x: 100, y: 100, w: 360, h: 240 });
    const nw = dragRect(s, "nw", -50, -50, 1.5, 1000, 800);
    assert.equal(nw.x + nw.w, 400);
    assert.equal(nw.y + nw.h, 300);
    assert.ok(Math.abs(nw.w / nw.h - 1.5) < 0.01);
    assert.ok(inside(nw, 1000, 800));
});

test("locked ratio: limited by the image, never outside", () => {
    const r = dragRect({ x: 0, y: 0, w: 100, h: 100 }, "se", 500, 500, 1, 200, 120);
    assert.deepEqual(r, { x: 0, y: 0, w: 120, h: 120 });
    for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w"])
        for (const [dx, dy] of [[-900, -900], [900, 900], [-900, 900], [900, -900], [7, -3], [0, 0]]) {
            const out = dragRect({ x: 300, y: 200, w: 300, h: 200 }, h, dx, dy, 1.5, 1000, 800);
            assert.ok(inside(out, 1000, 800), `${h} ${dx},${dy} -> ${JSON.stringify(out)}`);
            assert.ok(Math.abs(out.w / out.h - 1.5) < 0.02, `${h} ${dx},${dy} ratio ${out.w / out.h}`);
        }
});

test("locked ratio: an edge stays centred on the other axis", () => {
    const r = dragRect({ x: 100, y: 100, w: 200, h: 100 }, "e", 50, 0, 2, 1000, 800);
    assert.equal(r.x, 100);
    assert.equal(r.w, 250);
    assert.ok(Math.abs(r.y + r.h / 2 - 150) <= 1);
});

test("free drags never leave the image either", () => {
    for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w", "move"])
        for (const [dx, dy] of [[-900, -900], [900, 900], [-900, 900], [900, -900]])
            assert.ok(inside(dragRect({ x: 300, y: 200, w: 300, h: 200 }, h, dx, dy, null, 1000, 800), 1000, 800), h);
});

test("hitHandle: corners, edges, inside, outside", () => {
    const r = { x: 100, y: 100, w: 300, h: 200 };
    assert.equal(hitHandle(r, 102, 98, 24), "nw");
    assert.equal(hitHandle(r, 398, 302, 24), "se");
    assert.equal(hitHandle(r, 250, 95, 24), "n");
    assert.equal(hitHandle(r, 405, 200, 24), "e");
    assert.equal(hitHandle(r, 250, 200, 24), "move");
    assert.equal(hitHandle(r, 700, 700, 24), null);
});
