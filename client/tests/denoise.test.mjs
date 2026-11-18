import { test } from "node:test";
import assert from "node:assert/strict";
import { DENOISE_PRESETS, denoiseValue, TOOLS, patchFor, readValue } from "../dist/app/tools.js";
import { summarize } from "../dist/app/other.js";

const def = TOOLS.flatMap((t) => t.controls).find((c) => c.kind === "choice" && c.group === "Denoise");
const get = () => undefined;

test("each preset is recognised, and off is a disabled tool", () => {
    for (const [name, p] of Object.entries(DENOISE_PRESETS)) assert.equal(denoiseValue({ Enabled: true, ...p }), name);
    assert.equal(denoiseValue({ Enabled: false, ...DENOISE_PRESETS.high }), "off");
    assert.equal(denoiseValue(undefined), "off");
    assert.equal(denoiseValue({ Enabled: true, ...DENOISE_PRESETS.high, Luminance: 31 }), "custom");
});

test("choosing a preset writes all its keys, off only the switch", () => {
    assert.deepEqual(patchFor(def, "off", get), { Denoise: { Enabled: false } });
    const p = patchFor(def, "medium", get).Denoise;
    assert.equal(p.Enabled, true);
    assert.equal(p.Luminance, 15);
    assert.equal(p.SmoothingEnabled, true);
    assert.equal(readValue({ Denoise: { Enabled: true, ...DENOISE_PRESETS.low } }, def), "low");
});

test("the Other tab lists a denoise only when it is not a preset", () => {
    assert.equal(summarize({ Denoise: { Enabled: true, ...DENOISE_PRESETS.high } }).length, 0);
    assert.equal(summarize({ Denoise: { Enabled: true, ...DENOISE_PRESETS.high, Chrominance: 3 } }).length, 0);
    assert.equal(summarize({ Denoise: { Enabled: true, Luminance: 12 } }).length, 1);
});
