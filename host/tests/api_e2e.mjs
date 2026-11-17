// End-to-end test of metadata, profiles, geometry, the unsaved-edits guard and Save.
// Needs a host started on a COPY of an image (Save writes its sidecar):
//   node tests/api_e2e.mjs http://localhost:8080 /path/to/copy/photo.arw
import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:8080";
const image = realpathSync(process.argv[3] ?? "");  // the host reports canonical paths
const sidecar = image + ".arp";

// ---- a small client of the live channel ----------------------------------
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => {
    let m;
    if (typeof ev.data === "string") m = JSON.parse(ev.data);
    else {
        const dv = new DataView(ev.data), n = dv.getUint32(0);
        m = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data, 4, n)));
        m.jpeg = new Uint8Array(ev.data, 4 + n);
    }
    inbox.push(m);
    waiter?.();
};
const next = (pred, ms = 30000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const check = () => { const i = inbox.findIndex(pred); if (i >= 0) { clearTimeout(t); waiter = null; resolve(inbox.splice(i, 1)[0]); } else waiter = check; };
    check();
});
await new Promise((r) => (ws.onopen = r));
let seq = 1000;
const send = (o) => { const s = ++seq; ws.send(JSON.stringify({ ...o, seq: s })); return s; };
const api = async (path, init) => { const r = await fetch(base + path, init); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; };
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---- the sidecar, as groups of lines ---------------------------------------
// (numbers are compared as numbers: ART writes 0.7 as 0.69999999999999996)
const norm = (l) => { const i = l.indexOf("="); const v = l.slice(i + 1); return /^-?[\d.]+(e[-+]?\d+)?$/i.test(v) ? l.slice(0, i + 1) + Number(v) : l; };
const groups = (text) => { const g = {}; let cur = null; for (const l of text.split("\n")) { const m = l.match(/^\[(.*)\]$/); if (m) cur = g[m[1]] = []; else if (cur && l.trim()) cur.push(norm(l)); } return g; };

// a sidecar with snapshots, as desktop ART writes them, to check that Save keeps them
const before = readFileSync(sidecar, "utf8") + "\n[Snapshots]\nSnapshot_1=before MART\n\n[Snapshot_1 Exposure]\nEnabled=true\nCompensation=0.7\nBlack=0\nHLRecovery=Off\nHLRecoveryBlur=0\n";
writeFileSync(sidecar, before);
{ const r = await post("/api/open", { path: image, discard: true }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
const info0 = (await api("/api/info")).body;
const view = { x: 0, y: 0, w: 0, h: 0, out_w: 500 };
send({ type: "sync", view });
const st0 = await next((m) => m.type === "state");
await next((m) => m.type === "frame");
assert.equal(st0.size.full_width, info0.full_width);

// ---- metadata ---------------------------------------------------------------
{
    const r = await api("/api/metadata?makernotes=0&edits=0");
    assert.equal(r.status, 200);
    assert.equal(r.body["Exif.Image.Make"], info0.make);
    assert.ok(Object.keys(r.body).length > 20, "full metadata, not just the basics");
    console.log("metadata:", Object.keys(r.body).length, "tags");
}

// ---- profiles ---------------------------------------------------------------
const list = (await api("/api/profiles")).body;
assert.ok(Array.isArray(list) && list.length > 0, "profiles are listed");
console.log("profiles:", list.length, [...new Set(list.map((p) => p.source))].join(","), "e.g.", list[0].name);
{
    const sharp = list.find((p) => p.name === "Sharpening");
    assert.ok(sharp && sharp.source === "mine", "the test's own profile folder is offered; ART's are not");
    assert.ok(!list.some((p) => p.source === "bundled" || p.source === "user"), "ART's profiles are not loaded");
    {
        const s = send({ type: "profile", id: sharp.id, view });
        const st = await next((m) => m.type === "state" && m.seq === s);
        assert.equal(st.params.Sharpening.Enabled, true, "the Sharpening profile enables sharpening");
        await next((m) => m.type === "frame" && m.seq === s);
    }
    // ART's built-in profiles
    for (const id of [":neutral"]) {
        assert.ok(list.some((p) => p.id === id && p.source === "builtin"), id + " is listed");
        const s = send({ type: "profile", id, view });
        const st = await next((m) => m.type === "state" && m.seq === s);
        assert.notEqual(st.params.Sharpening?.Enabled, true, "neutral switches sharpening off");
        await next((m) => m.type === "frame" && m.seq === s);
    }
    // the built-in profiles replaced much of the state: start from the sidecar again
    { const r = await post("/api/open", { path: image, discard: true }); assert.equal(r.status, 200); }
    send({ type: "sync", view });
    await next((m) => m.type === "state");
    // upload
    assert.equal((await api("/api/profiles?name=x", { method: "POST", body: "this is not a profile" })).status, 400);
    assert.equal((await api("/api/profiles?name=x", { method: "POST", body: "" })).status, 400);
    const up = await api("/api/profiles?name=" + encodeURIComponent("../My look.arp"), { method: "POST", body: "[Saturation]\nEnabled=true\nSaturation=33\n" });
    assert.equal(up.status, 201);
    assert.equal(up.body.name, ".._My look", "the display name has no path");
    assert.ok((await api("/api/profiles")).body.some((p) => p.id === up.body.id && p.source === "uploaded"));
    const s = send({ type: "profile", id: up.body.id, view });
    const st = await next((m) => m.type === "state" && m.seq === s);
    assert.equal(st.params.Saturation.Saturation, 33);
    await next((m) => m.type === "frame" && m.seq === s);
    // unknown and malicious ids
    for (const id of ["nope", "d0:../../etc/passwd", "d0:/etc/passwd", "d9:x.arp", "u99"]) {
        const s2 = send({ type: "profile", id, view });
        const e = await next((m) => m.type === "error" && m.seq === s2);
        assert.match(e.message, /no such profile/);
    }
}

// ---- geometry ---------------------------------------------------------------
{
    // coarse rotation swaps the size; the old view no longer fits, so the frame shows the whole image
    const zoomed = { x: 1000, y: 3000, w: 1500, h: 1500, out_w: 300 };
    const s = send({ type: "edit", patch: { "Coarse Transformation": { Rotate: 90 } }, view: zoomed });
    const f = await next((m) => m.type === "frame" && m.seq === s);
    assert.deepEqual(f.size, { full_width: info0.full_height, full_height: info0.full_width });
    assert.deepEqual(f.region, { x: 0, y: 0, w: f.size.full_width, h: f.size.full_height }, "falls back to the whole image");
    // undo goes back to the original orientation
    const u = send({ type: "undo", view });
    const st = await next((m) => m.type === "state" && m.seq === u);
    assert.deepEqual(st.size, { full_width: info0.full_width, full_height: info0.full_height });
    await next((m) => m.type === "frame" && m.seq === u);
    // fine rotation and crop do not change the size
    const r = send({ type: "edit", patch: { Rotation: { Enabled: true, Degree: 3.5 }, Crop: { Enabled: true, X: 400, Y: 900, W: 1200, H: 800, FixedRatio: true, Ratio: "3:2", Orientation: "Landscape" } }, view });
    const fr = await next((m) => m.type === "frame" && m.seq === r);
    assert.deepEqual(fr.size, { full_width: info0.full_width, full_height: info0.full_height });
    send({ type: "sync", view });
    const st2 = await next((m) => m.type === "state");
    assert.equal(st2.params.Crop.W, 1200);
    assert.equal(st2.params.Rotation.Degree, 3.5);
}

// ---- the unsaved-edits guard and Save -----------------------------------------
{
    const e = await post("/api/open", { path: image });
    assert.equal(e.status, 409, "opening with unsaved edits needs discard");
    assert.equal((await api("/api/status")).body.dirty, true);
    const s = send({ type: "edit", patch: { Exposure: { Enabled: true, Compensation: 0.35 } }, merge: "exposure#1", view });
    await next((m) => m.type === "frame" && m.seq === s);
    const saved = await api("/api/save", { method: "POST" });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.file, sidecar);
    assert.equal((await api("/api/status")).body.dirty, false);

    // the sidecar: only what was edited changed, snapshots kept
    const after = readFileSync(sidecar, "utf8");
    const gb = groups(before), ga = groups(after);
    assert.ok(ga["Snapshots"] && ga["Snapshot_1 Exposure"], "snapshots survive");
    assert.deepEqual(ga["Snapshot_1 Exposure"], gb["Snapshot_1 Exposure"]);
    assert.deepEqual(ga["Snapshots"], gb["Snapshots"]);
    const edited = new Set(["Exposure", "Saturation", "Crop", "Rotation", "Version", "Sharpening", "ToneCurve", "White Balance"]);
    const changed = [];
    for (const g of Object.keys(gb)) {
        if (edited.has(g)) continue;
        let a = ga[g] ?? [], b = gb[g];
        if (g === "Denoise" && b.includes("ChrominanceMethod=1")) {
            // automatic chrominance: the engine re-estimates these three from the image, as it does in desktop ART
            const auto = /^Chrominance(RedGreen|BlueYellow)?=/;
            a = a.filter((l) => !auto.test(l)); b = b.filter((l) => !auto.test(l));
        }
        if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(g);
    }
    console.log("groups changed that were not edited:", changed.length ? changed : "none");
    for (const g of changed) {
        const a = new Set(ga[g] ?? []), b = new Set(gb[g]);
        console.log(`  [${g}] only before:`, gb[g].filter((l) => !a.has(l)), "only after:", (ga[g] ?? []).filter((l) => !b.has(l)));
    }
    assert.deepEqual(changed, [], "untouched groups are written back as they were");
    assert.match(ga["Exposure"].join("\n"), /Compensation=0\.35/);
    assert.match(ga["Crop"].join("\n"), /W=1200/);
    assert.match(ga["Saturation"].join("\n"), /Saturation=33/);

    // reopen: the sidecar gives back exactly what the editor had
    const was = (await api("/api/params")).body.params;
    const o = await post("/api/open", { path: image });
    assert.equal(o.status, 200, "no unsaved edits after Save");
    const now = (await api("/api/params")).body.params;
    assert.deepEqual(now, was, "the reopened image has the saved parameters");
}
ws.close();
console.log("api e2e: ok");
