import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, TONE_FIELDS, dabCount, dabsAlong, mergeRetouch, regionIds } from "../dist/app/retouch.js";
import { summarize } from "../dist/app/other.js";

test("regions are in the order of their ids, and a patch changes them as the host does", () => {
    const params = { Retouch: { 10: { Enabled: true }, 2: { Enabled: false, Slope: 2 } } };
    assert.deepEqual(regionIds(params), ["2", "10"]);
    mergeRetouch(params, { 2: { Enabled: true, HueShift: 5 }, 3: { Enabled: true }, 10: null });
    assert.deepEqual(regionIds(params), ["2", "3"]);
    assert.equal(params.Retouch["2"].Slope, 2);
    assert.equal(params.Retouch["2"].HueShift, 5);
    assert.deepEqual(params.Retouch["3"], { ...DEFAULTS, Enabled: true });
    const empty = {};
    mergeRetouch(empty, { 1: { Enabled: true } });
    assert.deepEqual(regionIds(empty), ["1"]);
});

test("the sliders of gain, gamma and pivot are in stops", () => {
    for (const k of ["Slope", "Power", "Pivot"]) {
        const f = TONE_FIELDS.find((f) => f.key === k);
        assert.equal(f.toUi(1), 0, k);
        assert.equal(f.toStored(0), 1, k);
        assert.equal(f.toStored(1), 2, k);
        assert.ok(Math.abs(f.toUi(f.toStored(-1.5)) + 1.5) < 1e-3, k);
    }
    // the ends of the sliders are inside what the host accepts
    const s = TONE_FIELDS.find((f) => f.key === "Slope"), p = TONE_FIELDS.find((f) => f.key === "Pivot");
    assert.ok(s.toStored(s.min) >= 0.01 && s.toStored(s.max) <= 32);
    assert.ok(p.toStored(p.min) >= 0.001 && p.toStored(p.max) <= 2);
});

test("dabs along a line, every `spacing`", () => {
    assert.deepEqual(dabsAlong(null, { x: 5, y: 5 }, 10), [{ x: 5, y: 5 }]);
    assert.deepEqual(dabsAlong({ x: 0, y: 0 }, { x: 5, y: 0 }, 10), []);
    const d = dabsAlong({ x: 0, y: 0 }, { x: 30, y: 40 }, 10);
    assert.equal(d.length, 5);
    assert.ok(Math.abs(d[0].x - 6) < 1e-9 && Math.abs(d[0].y - 8) < 1e-9);
    assert.equal(dabCount([[0.1, 1, 1, 0, 0, 1, 1], [0.1, 0, 1, 0.5, 0.5]]), 3);
});

test("the Other tab does not list the retouch regions, but the others of the tool", () => {
    const g = { Enabled: true, Mode_1: "YUV", MaskName_1: "sky", Mode_2: "Jzazbz", MaskName_2: "MART retouch 1" };
    const items = summarize({ ColorCorrection: g });
    assert.equal(items.length, 1);
    assert.equal(items[0].rows.length, 1);
    assert.equal(summarize({ ColorCorrection: { Enabled: true, Mode_1: "Jzazbz", MaskName_1: "MART retouch 4" } }).length, 0);
});
