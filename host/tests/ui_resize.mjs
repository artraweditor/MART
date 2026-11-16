// The picture must stay fully visible when the stage changes size (a taller panel on another tab, a rotated tablet).
//   node tests/ui_resize.mjs http://localhost:8080 [outdir]
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: "390,844" });
const { js } = b;
const until = async (what, fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
// is the whole displayed part of the image inside the canvas, and as big as it can be?
const fits = () => js(`(() => {
    const m = window.__mart, bd = m.bounds(), l = m.layout();
    const a = m.toPage(bd.x, bd.y), z = m.toPage(bd.x + bd.w, bd.y + bd.h);
    const c = document.getElementById("view").getBoundingClientRect();
    const inside = a.x >= c.left - 1 && a.y >= c.top - 1 && z.x <= c.right + 1 && z.y <= c.bottom + 1;
    const tight = Math.abs(l.zoom - l.fitZoom) < 1e-6 * l.fitZoom + 1e-9;
    return { inside, tight, zoom: l.zoom, fit: l.fitZoom, canvas: [l.cssW, l.cssH] };
})()`);
try {
    await b.emulate(390, 844);
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));
    await sleep(500);
    const check = async (what) => {
        await sleep(400);
        const f = await fits();
        console.log(what.padEnd(28), "canvas", f.canvas.join("x"), "zoom", f.zoom.toFixed(4), "fit", f.fit.toFixed(4), f.inside && f.tight ? "ok" : "NOT FITTED");
        assert.ok(f.inside, what + ": part of the picture is outside the view");
        assert.ok(f.tight, what + ": the picture is not fitted to the view");
    };
    await check("start");
    for (const tab of ["Color", "Tone", "Crop", "Tone", "Crop", "Color", "Tone"]) {
        await js(`[...document.querySelectorAll("#tabs button")].find(x => x.textContent === ${JSON.stringify(tab)}).click()`);
        await check("tab " + tab);
    }
    // the stage shrinks, grows, shrinks (a rotated or split-screen tablet)
    for (const [w, h] of [[390, 600], [390, 844], [500, 420], [390, 844]]) {
        await b.emulate(w, h);
        await check(`resize ${w}x${h}`);
    }
    // a zoomed view stays zoomed (not refitted) when the stage changes
    const bd = await js("window.__mart.bounds()");
    const p = await js(`window.__mart.toPage(${bd.x + bd.w / 2}, ${bd.y + bd.h / 2})`);
    await b.tap(p.x, p.y); await sleep(100); await b.tap(p.x, p.y); // double tap: zoom in
    await sleep(500);
    const z0 = (await js("window.__mart.layout()")).zoom, f0 = (await js("window.__mart.layout()")).fitZoom;
    assert.ok(z0 > f0 * 1.5, "double tap zoomed in");
    await b.emulate(390, 600);
    await sleep(500);
    const l1 = await js("window.__mart.layout()");
    assert.ok(l1.zoom > l1.fitZoom * 1.5 && !l1.fitted, "a zoomed-in view is not refitted on resize");
    console.log("exceptions:", b.logs.length ? b.logs : "none");
    console.log("ui resize: ok");
} finally {
    b.close();
}
