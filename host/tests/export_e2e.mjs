// End-to-end test of export: files, downloads, naming, busy state. Needs a host with an image open
// (exporting changes nothing on disk but a temporary folder):  node tests/export_e2e.mjs http://localhost:8080
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";
const api = async (path, init) => { const r = await fetch(base + path, init); const buf = Buffer.from(await r.arrayBuffer()); let j; try { j = JSON.parse(buf.toString()); } catch { j = null; } return { status: r.status, headers: r.headers, body: j, buf }; };
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// start from the image as saved on disk (earlier tests may have left edits in memory), and with no crop
const first0 = (await api("/api/info")).body;
assert.equal((await post("/api/open", { path: first0.file, discard: true })).status, 200);
const info = (await api("/api/info")).body;
const stem = info.file.split("/").pop().replace(/\.[^.]*$/, "");

// ---- readers of the image headers ---------------------------------------------------
const jpegSize = (b) => { assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8); for (let i = 2; i < b.length;) { assert.equal(b[i], 0xff); const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } throw new Error("no SOF"); };
const pngInfo = (b) => { assert.equal(b.subarray(1, 4).toString(), "PNG"); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24] }; };
const tiffInfo = (b) => {
    const le = b.toString("latin1", 0, 2) === "II"; assert.ok(le || b.toString("latin1", 0, 2) === "MM");
    const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    assert.equal(u16(2), 42);
    const ifd = u32(4), n = u16(ifd), r = {};
    for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const val = type === 3 && count === 1 ? u16(e + 8) : type === 4 && count === 1 ? u32(e + 8) : null;
        if (tag === 256) r.w = val; if (tag === 257) r.h = val;
        if (tag === 258) r.depth = count === 1 ? val : u16(u32(e + 8));
        if (tag === 259) r.compression = val;
    }
    return r;
};
const waitDone = async (id, ms = 120000) => { const t = Date.now(); for (;;) { const s = (await api("/api/export/" + id)).body; if (s.state === "done" || s.state === "error") return s; assert.ok(Date.now() - t < ms, "export timed out"); await sleep(200); } };
const exportFile = async (body) => { const r = await post("/api/export", body); assert.equal(r.status, 202, JSON.stringify(r.body)); const s = await waitDone(r.body.job); assert.equal(s.state, "done", JSON.stringify(s)); const f = await api(`/api/export/${r.body.job}/file`); assert.equal(f.status, 200); return { job: r.body.job, s, f }; };

// ---- formats, options --------------------------------------------------------------------
{
    const fm = (await api("/api/export/formats")).body;
    for (const f of ["jpg", "png", "tif"]) assert.ok(fm.includes(f), f);
    console.log("formats:", fm.length, "(" + fm.slice(0, 6).join(", ") + ", ...)");
    for (const [body, re] of [[{ format: "gif" }, /format/], [{ quality: 500 }, /quality/], [{ format: "png", quality: 5 }, /jpg only/], [{ format: "jpg", bits: 16 }, /png and tif/],
        [{ format: "tif", compression: "lzw" }, /none or zip/], [{ overwrite: true }, /unknown option/], [{ format: "tif", bits: 8, float: true }, /float/]]) {
        const r = await post("/api/export", body);
        assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.body.error, re);
    }
    assert.equal((await api("/api/export/e999")).status, 404);
    assert.equal((await api("/api/export/e999/file")).status, 404);
    assert.equal((await api("/api/export", { method: "POST", body: "not json" })).status, 400);
    // a refused request does not leave the exporter busy
    assert.equal((await api("/api/status")).body.busy, null);
}

// ---- a JPEG ----------------------------------------------------------------------------------
let first;
{
    const t0 = Date.now();
    const r = await post("/api/export", { format: "jpg", quality: 80 });
    assert.equal(r.status, 202);
    assert.equal((await post("/api/export", { format: "jpg" })).status, 409, "one export at a time");
    assert.equal((await api(`/api/export/${r.body.job}/file`)).status, 404, "no file before it is done");
    assert.equal((await api("/api/status")).body.busy, "exporting");
    const s = await waitDone(r.body.job);
    assert.equal(s.state, "done", JSON.stringify(s));
    assert.equal(s.name, stem + ".jpg");
    assert.equal(s.width, info.full_width); assert.equal(s.height, info.full_height);
    assert.equal(s.path, undefined, "the server's folder is not revealed when files are only for download");
    assert.ok(s.bytes > 10000);
    const f = await api(`/api/export/${r.body.job}/file`);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get("content-type"), "image/jpeg");
    assert.match(f.headers.get("content-disposition"), new RegExp(`^attachment; filename="${stem}\\.jpg"$`));
    assert.deepEqual(jpegSize(f.buf), { w: info.full_width, h: info.full_height });
    assert.equal(f.buf.length, s.bytes);
    first = f.buf.length;
    assert.equal((await api("/api/status")).body.busy, null);
    console.log(`jpg q80: ${info.full_width}x${info.full_height}, ${(f.buf.length / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
// the same name again does not overwrite: a lower quality is a smaller file with a new name
{
    const { s, f } = await exportFile({ format: "jpg", quality: 40 });
    assert.equal(s.name, stem + "-1.jpg");
    assert.ok(f.buf.length < first, "lower quality, smaller file");
    const again = await exportFile({ format: "jpg", name: "My shot (final).JPG" });
    assert.equal(again.s.name, "My shot (final).jpg");
    const evil = await exportFile({ format: "jpg", quality: 10, name: "../../tmp/evil" });
    assert.ok(!evil.s.name.includes("/"), evil.s.name);
    console.log("names:", s.name, "|", again.s.name, "|", evil.s.name);
}
// ---- PNG and TIFF ------------------------------------------------------------------------------
{
    const png = (await exportFile({ format: "png", bits: 16 })).f.buf;
    assert.deepEqual(pngInfo(png), { w: info.full_width, h: info.full_height, depth: 16 });
    const png8 = (await exportFile({ format: "png" })).f.buf;
    assert.equal(pngInfo(png8).depth, 8);
    const tif = await exportFile({ format: "tif", bits: 16, compression: "zip" });
    assert.equal(tif.f.headers.get("content-type"), "image/tiff");
    const ti = tiffInfo(tif.f.buf);
    assert.equal(ti.w, info.full_width); assert.equal(ti.h, info.full_height); assert.equal(ti.depth, 16);
    assert.notEqual(ti.compression, 1, "zip compression is not 'none'");
    console.log("png16 / png8 / tif16 zip: ok");
}

// ---- export uses the current, unsaved parameters; the engine is busy meanwhile; edits wait --------------------
{
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
    ws.binaryType = "arraybuffer";
    const inbox = [];
    ws.onmessage = (ev) => { if (typeof ev.data === "string") inbox.push(JSON.parse(ev.data)); else { const dv = new DataView(ev.data), n = dv.getUint32(0); inbox.push({ ...JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data, 4, n))), at: performance.now() }); } inbox.at(-1).t = performance.now(); };
    await new Promise((r) => (ws.onopen = r));
    const next = async (pred, ms = 60000) => { const t = Date.now(); for (;;) { const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0]; assert.ok(Date.now() - t < ms, "timeout"); await sleep(50); } };
    let seq = 5000;
    const send = (o) => { ws.send(JSON.stringify({ ...o, seq: ++seq })); return seq; };
    const view = { x: 0, y: 0, w: 0, h: 0, out_w: 400 };
    let s = send({ type: "edit", patch: { Crop: { Enabled: true, X: 400, Y: 900, W: 1200, H: 800, FixedRatio: false } }, view });
    await next((m) => m.type === "frame" && m.seq === s);
    const cropped = await exportFile({ format: "jpg", quality: 70 });
    assert.deepEqual(jpegSize(cropped.f.buf), { w: 1200, h: 800 }, "the export is the cropped image");
    assert.equal(cropped.s.width, 1200);

    // a slow export (16-bit TIFF): busy is announced, an edit sent meanwhile waits for it
    const job = (await post("/api/export", { format: "tif", bits: 16, name: "slow" })).body.job;
    const b1 = await next((m) => m.type === "busy");
    assert.equal(b1.what, "exporting");
    s = send({ type: "edit", patch: { Exposure: { Enabled: true, Compensation: 0.5 } }, view });
    const done = await waitDone(job);
    assert.equal(done.state, "done");
    const b2 = await next((m) => m.type === "busy");
    assert.equal(b2.what, null);
    const fr = await next((m) => m.type === "frame" && m.seq === s);
    assert.ok(fr.t >= b2.t - 5, "the edit was applied after the export");
    // a client that connects during an export is told at once
    const job2 = (await post("/api/export", { format: "tif", bits: 16, name: "slow2" })).body.job;
    const ws2 = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
    const first2 = await new Promise((res) => { ws2.onmessage = (ev) => res(JSON.parse(ev.data)); });
    assert.deepEqual(first2, { type: "busy", what: "exporting" });
    ws2.close(); ws.close();
    assert.equal((await waitDone(job2)).state, "done");
    console.log("busy state, queued edit, export of the cropped image: ok");
}
console.log("export e2e: ok");
