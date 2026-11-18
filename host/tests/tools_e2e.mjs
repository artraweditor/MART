// The tools of the panel against the real engine: the patches are accepted and come back as the parameters
// the client reads (curve, tone equalizer, channel mixer, soft light, lens correction, capture sharpening).
//   node tests/tools_e2e.mjs http://localhost:8080        (host started on an image; nothing is saved)
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => {
    let m;
    if (typeof ev.data === "string") m = JSON.parse(ev.data);
    else { const dv = new DataView(ev.data), n = dv.getUint32(0); m = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data, 4, n))); m.frame = true; }
    inbox.push(m);
    waiter?.();
};
const next = (pred, ms = 30000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const check = () => { const i = inbox.findIndex(pred); if (i >= 0) { clearTimeout(t); waiter = null; resolve(inbox.splice(i, 1)[0]); } else waiter = check; };
    check();
});
await new Promise((r) => (ws.onopen = r));
let seq = 100;
const view = { x: 0, y: 0, w: 0, h: 0, out_w: 400 };
const send = (o) => { const s = ++seq; ws.send(JSON.stringify({ ...o, seq: s, view })); return s; };
const params = async () => (await (await fetch(base + "/api/params")).json()).params;
const edit = async (patch) => { const s = send({ type: "edit", patch }); await next((m) => m.frame && m.seq === s); return params(); };
const refused = async (patch) => { const s = send({ type: "edit", patch }); const m = await next((x) => x.type === "error" && x.seq === s); return m.message; };

// the preview is tagged as sRGB (ART renders it in sRGB but writes no profile)
{
    const jpeg = Buffer.from(await (await fetch(base + "/api/preview?out_w=300")).arrayBuffer());
    assert.equal(jpeg[0], 0xff); assert.equal(jpeg[1], 0xd8);
    const at = jpeg.indexOf("ICC_PROFILE\0");
    assert.ok(at > 0 && at < 64, "the profile is in the header, at " + at);
    assert.ok(jpeg.includes("sRGB (ICC V2)"), "it is the sRGB profile");
    assert.equal(jpeg.indexOf("ICC_PROFILE\0", at + 1), -1, "once");
    console.log("preview tagged as sRGB: ok");
}

send({ type: "sync" });
const first = await next((m) => m.type === "state");
void first;

// tone curve
let p = await edit({ ToneCurve: { Enabled: true, CurveMode: "Neutral", CurveMode2: "Neutral", Curve: [1, 0, 0, 0.5, 0.6, 1, 1] } });
assert.equal(p.ToneCurve.CurveMode, "Neutral");
assert.match(await refused({ ToneCurve: { CurveMode: "Standard" } }), /not an allowed value/);
assert.deepEqual(p.ToneCurve.Curve.split(";").filter(Boolean).map(Number), [1, 0, 0, 0.5, 0.6, 1, 1]);
p = await edit({ ToneCurve: { Curve: [0] } });
assert.equal(p.ToneCurve.Curve, "0;", "the identity");
console.log("tone curve: ok");

// tone equalizer
p = await edit({ ToneEqualizer: { Enabled: true, Band1: 35, Band3: -25, Pivot: 0.5, Regularization: 3 } });
assert.deepEqual([p.ToneEqualizer.Enabled, p.ToneEqualizer.Band1, p.ToneEqualizer.Band3, p.ToneEqualizer.Pivot, p.ToneEqualizer.Regularization], [true, 35, -25, 0.5, 3]);
console.log("tone equalizer: ok");

// channel mixer: primaries mode
p = await edit({ "Channel Mixer": { Enabled: true, Mode: 1, HueTweak: [10, 0, -20], SatTweak: [0, 30, 0] } });
assert.equal(p["Channel Mixer"].Mode, 1);
assert.deepEqual(p["Channel Mixer"].HueTweak.split(";").filter(Boolean).map(Number), [10, 0, -20]);
assert.match(await refused({ "Channel Mixer": { Red: [900, 100, 0] } }), /unknown key/);
console.log("channel mixer: ok");

// soft light
p = await edit({ SoftLight: { Enabled: true, Strength: 45 } });
assert.deepEqual([p.SoftLight.Enabled, p.SoftLight.Strength], [true, 45]);
console.log("soft light: ok");

// lens correction: no Enabled key
console.log("lens params before:", JSON.stringify((await params()).LensProfile));
p = await edit({ LensProfile: { LcMode: "lfauto", UseDistortion: true, UseVignette: true, UseCA: true } });
assert.equal(p.LensProfile.LcMode, "lfauto");
assert.equal(p.LensProfile.UseCA, true);
p = await edit({ LensProfile: { LcMode: "exif" } });
assert.equal(p.LensProfile.LcMode, "exif");
p = await edit({ LensProfile: { LcMode: "none" } });
assert.equal(p.LensProfile.LcMode, "none");
assert.match(await refused({ LensProfile: { LcMode: "lcp" } }), /not an allowed value/);
console.log("lens correction: ok");

// capture sharpening
p = await edit({ Sharpening: { Enabled: true, Method: "rld", DeconvAutoRadius: false, DeconvRadius: 0.9, DeconvAmount: 70, Contrast: 30 } });
const S = p.Sharpening;
assert.deepEqual([S.Enabled, S.Method, S.DeconvAutoRadius, S.DeconvRadius, S.DeconvAmount, S.Contrast], [true, "rld", false, 0.9, 70, 30]);
assert.match(await refused({ Sharpening: { Method: "usm" } }), /not an allowed value/);
console.log("capture sharpening: ok");

// haze removal: a straight strength curve in RGB mode
const snap = async () => Buffer.from(await (await fetch(base + "/api/preview?out_w=200")).arrayBuffer()).toString("base64");
const noHaze = await snap();
p = await edit({ Dehaze: { Enabled: true, Strength: 0.8, Luminance: false } });
assert.notEqual(await snap(), noHaze, "removing haze changes the picture");
assert.equal(p.Dehaze.Enabled, true);
assert.equal(p.Dehaze.Luminance, false);
assert.deepEqual(p.Dehaze.Strength.split(";").filter(Boolean).map(Number), [1, 0, 0.8, 0, 0, 1, 0.8, 0, 0]);
assert.match(await refused({ Dehaze: { Strength: 2 } }), /number from 0 to 1/);
assert.match(await refused({ Dehaze: { Depth: 40 } }), /unknown key/);
p = await edit({ Dehaze: { Enabled: false, Strength: 0.5, Luminance: false } });
assert.equal(p.Dehaze.Enabled, false);
console.log("haze removal: ok");

// the embedded flat field of the raw file
p = await edit({ RAW: { FlatFieldUseEmbedded: true, FlatFieldEnabled: true } });
assert.deepEqual([p.RAW.FlatFieldEnabled, p.RAW.FlatFieldUseEmbedded], [true, true]);
assert.match(await refused({ RAW: { FlatFieldFile: "/etc/passwd" } }), /unknown key/);
p = await edit({ RAW: { FlatFieldUseEmbedded: false } });
assert.deepEqual([p.RAW.FlatFieldEnabled, p.RAW.FlatFieldUseEmbedded], [true, false]);
console.log("embedded flat field: ok");

// film grain
p = await edit({ Grain: { Enabled: true, ISO: 800, Strength: 35, Color: true } });
assert.deepEqual([p.Grain.Enabled, p.Grain.ISO, p.Grain.Strength, p.Grain.Color], [true, 800, 35, true]);
console.log("film grain: ok");

// halation: a Smoothing region in halation mode, after the ones of the sidecar, found again by its name
const smoothing = async () => (await params()).Smoothing;
const before = await smoothing();
const regions = (sm) => Object.keys(sm).filter((k) => /^Mode_\d+$/.test(k)).length;
const n0 = regions(before);
p = await edit({ Halation: { Enabled: true, Strength: 2.5, Tint: -0.2 } });
assert.deepEqual(p.Halation, { Enabled: true, Strength: 2.5, Tint: -0.2 });
let sm = p.Smoothing;
assert.equal(regions(sm), n0 + 1, "one region was added");
assert.equal(sm["Mode_" + (n0 + 1)], 7);
assert.equal(sm["MaskName_" + (n0 + 1)], "MART halation");
assert.equal(sm.Enabled, true);
for (const [k, v] of Object.entries(before)) if (/_\d+$/.test(k) && Number(k.match(/_(\d+)$/)[1]) <= n0) assert.deepEqual(sm[k], v, "the sidecar's region is unchanged: " + k);
p = await edit({ Halation: { Enabled: true, Strength: 1.2 } });
assert.equal(regions(p.Smoothing), n0 + 1, "editing changes the region in place");
assert.deepEqual(p.Halation, { Enabled: true, Strength: 1.2, Tint: -0.2 });
p = await edit({ Halation: { Enabled: false } });
assert.equal(p.Halation.Enabled, false);
assert.equal(regions(p.Smoothing), n0 + 1, "the region stays, off");
assert.match(await refused({ Halation: { Strength: 9 } }), /out of range/);
assert.match(await refused({ Halation: { Mode: 3 } }), /unknown key/);
// undo: the preview of the image before and after halation differs
console.log("halation: ok");

// film simulation: a CTL script from this device, its parameters, and the effect
const ctl = `// @ART-label: "Test"
// @ART-param: ["gain", "Gain", -1.0, 1.0, 0.5, 0.1]
// @ART-param: ["steps", "$TP_FILMSIMULATION_STRENGTH;Steps", 1, 10, 3]
// @ART-param: ["inv", "Invert", true]
// @ART-param: ["mode", "Mode", ["Option A", "Option B"], 1]
void ART_main(varying float r, varying float g, varying float b, output varying float rout, output varying float gout, output varying float bout, float gain, int steps, bool inv, int mode)
{
    rout = r * (1 + gain); gout = g; bout = b;
}
`;
const up = await fetch(base + "/api/luts?name=" + encodeURIComponent("../my test.ctl"), { method: "POST", body: ctl });
assert.equal(up.status, 201);
const lut = await up.json();
assert.equal(lut.name, "_my test.ctl", "no path in the name, nothing hidden");
assert.ok((await (await fetch(base + "/api/luts")).json()).some((l) => l.id === lut.id && l.source === "mine"));
assert.equal((await fetch(base + "/api/luts?name=x.exe", { method: "POST", body: "MZ" })).status, 400, "not a LUT");
assert.equal((await fetch(base + "/api/luts?name=x.ctl", { method: "POST", body: "" })).status, 400);
assert.match(await refused({ "Film Simulation": { ClutFilename: "/etc/passwd" } }), /no such LUT/);
const mean = async () => { const b = Buffer.from(await (await fetch(base + "/api/preview?out_w=200")).arrayBuffer()); return b.length + ":" + b.reduce((a, x) => (a * 31 + x) >>> 0, 7); };
p = await edit({ "Film Simulation": { Enabled: false } });
const plain = await mean();
p = await edit({ "Film Simulation": { Enabled: true, ClutFilename: lut.id, ClutParams: {}, Strength: 100 } });
assert.ok(decodeURIComponent(p["Film Simulation"].ClutFilename).endsWith("/_my test.ctl"), p["Film Simulation"].ClutFilename);
console.log("clut filename:", p["Film Simulation"].ClutFilename);
const lp = await (await fetch(base + "/api/lut/params")).json();
assert.deepEqual(lp.params.map((x) => [x.name, x.type, x.label]), [["gain", "float", "Gain"], ["steps", "int", "Strength"], ["inv", "bool", "Invert"], ["mode", "choice", "Mode"]]);
assert.deepEqual(lp.params[0].default, [0.5]);
assert.deepEqual(lp.params[3].choices, [{ label: "Option A", value: 0 }, { label: "Option B", value: 1 }]);
p = await edit({ "Film Simulation": { ClutParams: { gain: [0.9], steps: [4], inv: [0], mode: [1] } } });
console.log("clut params:", p["Film Simulation"].ClutParams);
assert.match(p["Film Simulation"].ClutParams, /gain=0\.9\d*/);
const withLut = await mean();
assert.notEqual(withLut, plain, "the script changes the picture");
p = await edit({ "Film Simulation": { ClutParams: { gain: [-0.9], steps: [4], inv: [0], mode: [1] } } });
assert.notEqual(await mean(), withLut, "its parameter changes the picture");
p = await edit({ "Film Simulation": { Enabled: false, ClutFilename: "" } });
assert.equal(p["Film Simulation"].ClutFilename, "");
assert.deepEqual(await (await fetch(base + "/api/lut/params")).json(), { params: [], presets: [] });
assert.equal((await fetch(base + "/api/luts", { method: "POST", body: ctl })).status, 400, "no name");
assert.equal((await fetch(base + "/api/luts?name=" + encodeURIComponent("_my test.ctl"), { method: "POST", body: ctl })).status, 409, "the name is taken");
assert.equal((await fetch(base + "/api/luts/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lut.id }) })).status, 200, "(the test's own LUT goes away)");
console.log("film simulation: ok");

ws.close();
console.log("tools e2e: ok");
