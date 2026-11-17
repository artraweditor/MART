import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../dist/app/other.js";

test("tools with controls are not listed, disabled ones neither", () => {
    const items = summarize({
        Exposure: { Enabled: true, Compensation: 1 },
        ToneCurve: { Enabled: true },
        Grain: { Enabled: true },
        Halation: { Enabled: true, Strength: 1, Tint: 0 },
        Dehaze: { Enabled: false, Strength: 50 },
        Version: { Version: 1047 },
        MetaData: { Exif: "x" },
        "Color Management": { InputProfile: "(cameraICC)" },
    });
    assert.deepEqual(items, []);
});

test("other tools: their keys, without Enabled", () => {
    const items = summarize({ Denoise: { Enabled: true, Chrominance: 2.7, Aggressive: false }, "HSL Equalizer": { Enabled: true, SCurve: "1;0;0.5;" } });
    assert.deepEqual(items.map((i) => i.name), ["Color equalizer", "Noise reduction"]);
    assert.deepEqual(items[1].rows, [["Chrominance", "2.7"], ["Aggressive", "false"]]);
});

test("smoothing: its regions, but not the halation of the Detail tab", () => {
    const g = { Enabled: true, Mode_1: 3, Channel_1: 1, MaskName_1: "", MaskEnabled_1: true, Mode_2: 7, MaskName_2: "MART halation", MaskEnabled_2: true, Mode_3: 0, Channel_3: 0, MaskEnabled_3: false };
    const [s] = summarize({ Smoothing: g });
    assert.equal(s.summary, "2 regions");
    assert.deepEqual(s.rows, [["Region 1", "Non-local means, chrominance"], ["Region 3", "Guided, luminance (off)"]]);
    // only the halation: nothing to tell
    assert.deepEqual(summarize({ Smoothing: { Enabled: true, Mode_1: 7, MaskName_1: "MART halation" } }), []);
    // a halation made in ART (another name) is listed
    assert.equal(summarize({ Smoothing: { Enabled: true, Mode_1: 7, MaskName_1: "" } })[0].rows[0][1], "Halation");
});

test("region tools: how many regions", () => {
    const items = summarize({
        ColorCorrection: { Enabled: true, Mode_1: "Jzazbz", Mode_2: "HSL" },
        "Local Contrast": { Enabled: true, Contrast: 10, Contrast_1: 5 },
        TextureBoost: { Enabled: true, Strength: 5 },
    });
    assert.deepEqual(items.map((i) => [i.name, i.summary]), [["Color/tone correction", "2 regions"], ["Local contrast", "2 regions"], ["Texture boost", "1 region"]]);
    assert.deepEqual(items[0].rows, [["Region 1", "Jzazbz"], ["Region 2", "HSL"]]);
});

test("long values are cut", () => {
    const [i] = summarize({ "RGB Curves": { Enabled: true, rCurve: "1;" + "0.123456;".repeat(30) } });
    assert.ok(i.rows[0][1].length <= 90 && i.rows[0][1].endsWith("…"));
});

test("dehaze has a control: not listed", () => {
    assert.deepEqual(summarize({ Dehaze: { Enabled: true, Strength: "1;0;0.75;0;0;1;0.75;0;0;", Depth: 25 } }), []);
});
