// Run with: npm test (after npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePatch } from "../dist/app/throttle.js";
import { TOOLS, patchFor, readValue, isShown } from "../dist/app/tools.js";

const find = (key) => TOOLS.flatMap((t) => t.controls).find((c) => c.key === key);

test("mergePatch: later values win, nothing is lost", () => {
    const m = mergePatch({ Exposure: { Compensation: 1 } }, { Exposure: { Black: 0.1 }, Saturation: { Saturation: 5 } });
    assert.deepEqual(m, { Exposure: { Compensation: 1, Black: 0.1 }, Saturation: { Saturation: 5 } });
    assert.deepEqual(mergePatch(m, { Exposure: { Compensation: 2 } }).Exposure, { Compensation: 2, Black: 0.1 });
});

test("a slider enables its tool", () => {
    assert.deepEqual(patchFor(find("Contrast"), 20, () => undefined), { ToneCurve: { Enabled: true, CurveMode: "Neutral", CurveMode2: "Neutral", Contrast: 20 } });
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

const control = (group, key, index) => TOOLS.flatMap((t) => t.controls).find((c) => c.group === group && c.key === key && c.index === index);
const noParams = () => undefined;

test("tone equalizer bands", () => {
    assert.deepEqual(patchFor(control("ToneEqualizer", "Band1"), 35, noParams), { ToneEqualizer: { Enabled: true, Band1: 35 } });
});

test("primaries mode writes the tweaks and the mode", () => {
    const get = (g, k) => ({ "Channel Mixer": { HueTweak: "0;10;0;" } })[g]?.[k];
    assert.deepEqual(patchFor(control("Channel Mixer", "HueTweak", 2), -30, get)["Channel Mixer"], { Enabled: true, Mode: 1, HueTweak: [0, 10, -30] });
});

test("lens correction has no Enabled key", () => {
    assert.deepEqual(patchFor(control("LensProfile", "LcMode"), "lfauto", noParams), { LensProfile: { LcMode: "lfauto" } });
    const dist = control("LensProfile", "UseDistortion");
    assert.equal(isShown({}, dist), false);
    assert.equal(isShown({ LensProfile: { LcMode: "exif" } }, dist), true);
    assert.equal(isShown({ LensProfile: { LcMode: "none" } }, dist), false);
});

test("capture sharpening is deconvolution with a fixed radius", () => {
    const get = (g, k) => ({ Sharpening: { DeconvRadius: 0.9 } })[g]?.[k];
    assert.deepEqual(patchFor(control("Sharpening", "DeconvAmount"), 60, get).Sharpening,
        { Enabled: true, Method: "rld", DeconvAutoRadius: false, DeconvRadius: 0.9, DeconvAmount: 60 });
    assert.equal(patchFor(control("Sharpening", "DeconvRadius"), 1.2, get).Sharpening.DeconvRadius, 1.2);
    assert.equal(patchFor(control("Sharpening", "Enabled"), false, get).Sharpening.Enabled, false);
    assert.equal(patchFor(control("Sharpening", "Contrast"), 30, noParams).Sharpening.DeconvRadius, 0.75);
});

test("the tone curve goes as a list", () => {
    assert.deepEqual(patchFor(control("ToneCurve", "Curve"), [1, 0, 0, 0.5, 0.6, 1, 1], noParams), { ToneCurve: { Enabled: true, CurveMode: "Neutral", CurveMode2: "Neutral", Curve: [1, 0, 0, 0.5, 0.6, 1, 1] } });
});

test("film grain", () => {
    assert.deepEqual(patchFor(control("Grain", "ISO"), 800, noParams), { Grain: { Enabled: true, ISO: 800 } });
    assert.deepEqual(patchFor(control("Grain", "Enabled"), false, noParams), { Grain: { Enabled: false } });
});

test("halation is a group of its own, for the host to turn into a smoothing region", () => {
    assert.deepEqual(patchFor(control("Halation", "Strength"), 2, noParams), { Halation: { Enabled: true, Strength: 2 } });
    assert.deepEqual(patchFor(control("Halation", "Tint"), -0.2, noParams), { Halation: { Enabled: true, Tint: -0.2 } });
    assert.deepEqual(patchFor(control("Halation", "Enabled"), false, noParams), { Halation: { Enabled: false } });
});

test("haze removal: one slider for a straight dehaze curve, in RGB mode", () => {
    const d = control("Dehaze", "Strength");
    assert.deepEqual(patchFor(d, 50, noParams), { Dehaze: { Enabled: true, Strength: 0.75, Luminance: false } });
    assert.deepEqual(patchFor(d, -40, noParams), { Dehaze: { Enabled: true, Strength: 0.3, Luminance: false } });
    assert.deepEqual(patchFor(d, 100, noParams).Dehaze.Strength, 1);
    // at zero the tool is off
    assert.deepEqual(patchFor(d, 0, noParams), { Dehaze: { Enabled: false, Strength: 0.5, Luminance: false } });
});

test("haze removal: reading the strength curve of the profile", () => {
    const d = control("Dehaze", "Strength");
    const on = (curve) => ({ Dehaze: { Enabled: true, Strength: curve } });
    assert.equal(readValue(on("1;0;0.75;0;0;1;0.75;0;0;"), d), 50);
    assert.equal(readValue(on("1;0;0.3;0;0;1;0.3;0;0;"), d), -40);
    assert.equal(readValue(on("1;0;0.5;0;0;1;0.5;0;0;"), d), 0);
    // a curve made in ART that is not straight: its mean level
    assert.equal(readValue(on("1;0;0.6;0;0;0.5;0.7;0;0;1;0.8;0;0;"), d), 40);
    assert.equal(readValue({ Dehaze: { Enabled: false, Strength: "1;0;0.9;0;0;1;0.9;0;0;" } }, d), 0, "off: zero");
    assert.equal(readValue({}, d), 0);
    assert.equal(readValue(on("0;"), d), 0);
});

test("the embedded flat field: checking it turns the flat field on", () => {
    const t = control("RAW", "FlatFieldUseEmbedded");
    assert.deepEqual(patchFor(t, true, noParams), { RAW: { FlatFieldUseEmbedded: true, FlatFieldEnabled: true } });
    // unchecking leaves the other flat field settings as they are; the group has no Enabled key
    assert.deepEqual(patchFor(t, false, noParams), { RAW: { FlatFieldUseEmbedded: false } });
    assert.equal(readValue({ RAW: { FlatFieldUseEmbedded: true } }, t), true);
    assert.equal(readValue({}, t), false);
});

test("haze removal: the slider keeps its value after its own patch is merged into the parameters", () => {
    // the client merges a patch into its parameters at once, so for a while Strength is the level, not the curve text
    const d = control("Dehaze", "Strength");
    for (const v of [-100, -30, 0, 1, 40, 100]) {
        const merged = { Dehaze: { Enabled: v !== 0, ...patchFor(d, v, noParams).Dehaze } };
        merged.Dehaze.Enabled = v !== 0;
        assert.equal(readValue(merged, d), v, `value ${v}`);
    }
    assert.equal(readValue({ Dehaze: { Enabled: true, Strength: 0.7 } }, d), 40);
    assert.equal(readValue({ Dehaze: { Enabled: true, Strength: NaN } }, d), 0);
});
