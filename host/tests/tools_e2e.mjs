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

send({ type: "sync" });
await next((m) => m.type === "state");

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

ws.close();
console.log("tools e2e: ok");
