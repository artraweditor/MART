// Run with: npm test (after npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePatch } from "../dist/app/throttle.js";
import { TOOLS, patchFor, readValue } from "../dist/app/tools.js";

const find = (key) => TOOLS.flatMap((t) => t.controls).find((c) => c.key === key);

test("mergePatch: later values win, nothing is lost", () => {
    const m = mergePatch({ Exposure: { Compensation: 1 } }, { Exposure: { Black: 0.1 }, Saturation: { Saturation: 5 } });
    assert.deepEqual(m, { Exposure: { Compensation: 1, Black: 0.1 }, Saturation: { Saturation: 5 } });
    assert.deepEqual(mergePatch(m, { Exposure: { Compensation: 2 } }).Exposure, { Compensation: 2, Black: 0.1 });
});

test("a slider enables its tool", () => {
    assert.deepEqual(patchFor(find("Contrast"), 20, () => undefined), { ToneCurve: { Enabled: true, Contrast: 20 } });
});

test("white balance sliders always carry the other value and the custom setting", () => {
    const get = (g, k) => ({ "White Balance": { Temperature: 5170, Green: 0.977 } })[g]?.[k];
    assert.deepEqual(patchFor(find("Temperature"), 6000, get), {
        "White Balance": { Enabled: true, Setting: "CustomTemp", Green: 0.977, Temperature: 6000 },
    });
    assert.deepEqual(patchFor(find("Green"), 1.1, get), {
        "White Balance": { Enabled: true, Setting: "CustomTemp", Temperature: 5170, Green: 1.1 },
    });
    // a preset is just the setting
    assert.deepEqual(patchFor(find("Setting"), "Camera", get), { "White Balance": { Enabled: true, Setting: "Camera" } });
});

test("temperature is an integer", () => {
    const p = patchFor(find("Green"), 1, (g, k) => (k === "Temperature" ? 5170.4 : undefined));
    assert.equal(p["White Balance"].Temperature, 5170);
});

test("readValue falls back to the default", () => {
    assert.equal(readValue({}, find("Compensation")), 0);
    assert.equal(readValue({ Exposure: { Compensation: 0.7 } }, find("Compensation")), 0.7);
    assert.equal(readValue({}, find("HLRecovery")), "Off");
});

test("every control's range holds its default", () => {
    for (const c of TOOLS.flatMap((t) => t.controls))
        if (c.kind === "slider") assert.ok(c.def >= c.min && c.def <= c.max, c.label);
});
