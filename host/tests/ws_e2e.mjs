// End-to-end test of the live edit channel. Needs a running host with an image open:
//   mart --www ../client/dist ... photo.arw     then     node tests/ws_e2e.mjs [http://localhost:8080]
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => {
    let m;
    if (typeof ev.data === "string") m = JSON.parse(ev.data);
    else {
        const dv = new DataView(ev.data);
        const n = dv.getUint32(0);
        m = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data, 4, n)));
        m.jpeg = new Uint8Array(ev.data, 4 + n);
    }
    inbox.push(m);
    waiter?.();
};
const next = (pred, ms = 20000) =>
    new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), ms);
        const check = () => {
            const i = inbox.findIndex(pred);
            if (i >= 0) {
                clearTimeout(t);
                waiter = null;
                resolve(inbox.splice(i, 1)[0]);
            } else waiter = check;
        };
        check();
    });
await new Promise((r) => (ws.onopen = r));
const send = (o) => ws.send(JSON.stringify(o));
const info = await (await fetch(base + "/api/info")).json();
const view = { x: 0, y: 0, w: 0, h: 0, out_w: 600 };

send({ type: "sync", seq: 1, view });
const st0 = await next((m) => m.type === "state");
const fr0 = await next((m) => m.type === "frame");
assert.equal(fr0.w, 600);
assert.equal(fr0.jpeg[0], 0xff); // JPEG magic
assert.ok(Buffer.from(fr0.jpeg.subarray(0, 64)).includes("ICC_PROFILE\0"), "the frames are tagged with a profile (sRGB)");
const n0 = st0.history.count;
console.log("initial", st0.history, "exposure", st0.params.Exposure.Compensation);

// 30 edits of one gesture, as fast as possible: few frames, one history entry
const t0 = Date.now();
for (let i = 1; i <= 30; i++)
    send({ type: "edit", seq: 100 + i, merge: "exposure#1", patch: { Exposure: { Enabled: true, Compensation: i / 30 } }, view });
let frames = 0, last;
while (!last || last.seq < 130) {
    last = await next((m) => m.type === "frame" || m.type === "error");
    assert.notEqual(last.type, "error", last.message);
    frames++;
}
console.log(`30 edits -> ${frames} frames in ${Date.now() - t0} ms, last frame ${last.ms} ms`);
assert.ok(frames < 30);
assert.equal(last.history.count, n0 + 1, "one history entry per gesture");
assert.equal(last.dirty, true);

// a second gesture is a second entry
send({ type: "edit", seq: 200, merge: "exposure#2", patch: { Exposure: { Compensation: -0.5 } }, view });
const f2 = await next((m) => m.type === "frame" && m.seq === 200);
assert.equal(f2.history.count, n0 + 2);

// undo goes back one gesture, redo forward
send({ type: "undo", seq: 300, view });
const s3 = await next((m) => m.type === "state" && m.seq === 300);
assert.equal(s3.history.count, n0 + 2);
assert.ok(Math.abs(s3.params.Exposure.Compensation - 1) < 1e-6, "undo restores the end of gesture 1");
await next((m) => m.type === "frame" && m.seq === 300);
send({ type: "redo", seq: 301, view });
const s4 = await next((m) => m.type === "state" && m.seq === 301);
assert.ok(Math.abs(s4.params.Exposure.Compensation + 0.5) < 1e-6);

// bad patches are refused with an error, not applied
for (const patch of [{ Nope: { A: 1 } }, { Exposure: { Compensation: 99 } }, { Exposure: { Nope: 1 } }, { "White Balance": { Setting: "x\n[Crop]" } }]) {
    send({ type: "edit", seq: 400, patch, view });
    const e = await next((m) => m.type === "error" && m.seq === 400);
    console.log("refused:", e.message);
}
// white balance: set a temperature, expect the engine to take it
send({ type: "edit", seq: 500, merge: "wb#1", patch: { "White Balance": { Setting: "CustomTemp", Temperature: 4000, Green: 1 } }, view });
await next((m) => m.type === "frame" && m.seq === 500);
send({ type: "sync", seq: 501, view });
const s5 = await next((m) => m.type === "state" && m.seq === 501);
assert.equal(s5.params["White Balance"].Temperature, 4000);

// a newer connection takes over
const ws2 = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
await new Promise((r) => (ws2.onopen = r));
await next((m) => m.type === "replaced");
ws2.close();
ws.close();
console.log("ws e2e: ok (image", info.file.split("/").pop() + ")");
