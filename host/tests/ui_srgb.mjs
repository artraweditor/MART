// The preview is sRGB whatever the profiles of the image say: applying a profile that changes the working and
// output profiles to wide gamut ones must not change the colours of the frames (as an untagged wide gamut preview
// would), and the frames carry the sRGB profile.   node tests/ui_srgb.mjs http://localhost:8080 outdir   (fresh host)
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp" });
const { js } = b;
// the mean R, G, B of the preview as the browser decodes it
const mean = () => js(`(async () => {
    const bmp = await createImageBitmap(await (await fetch("/api/preview?out_w=300", { cache: "no-store" })).blob());
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return s.map((v) => v / (d.length / 4));
})()`);
try {
    await b.goto(base);
    for (let i = 0; i < 100 && !(await js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`)); i++) await sleep(100);
    const before = await mean();
    const up = await (await fetch(base + "/api/profiles?name=wide.arp", { method: "POST", body: "[Color Management]\nWorkingProfile=ProPhoto\nOutputProfile=RTv4_DisplayP3\n" })).json();
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
    await new Promise((r) => (ws.onopen = r));
    const got = new Promise((r) => (ws.onmessage = (e) => { if (typeof e.data === "string" && JSON.parse(e.data).type === "state") r(JSON.parse(e.data)); }));
    ws.send(JSON.stringify({ type: "profile", id: up.id, seq: 1, view: { x: 0, y: 0, w: 0, h: 0, out_w: 300 } }));
    const st = await got;
    assert.equal(st.params["Color Management"].WorkingProfile, "ProPhoto", "the profile was applied");
    assert.equal(st.params["Color Management"].OutputProfile, "RTv4_DisplayP3");
    const after = await mean();
    ws.close();
    console.log("mean RGB before", before.map((v) => v.toFixed(1)).join(","), "after", after.map((v) => v.toFixed(1)).join(","));
    // the working space changes the processing a little; a wide gamut preview read as sRGB would be far off
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(before[k] - after[k]) < 3, `channel ${k}: ${before[k]} -> ${after[k]}`);
    console.log("ui srgb: ok");
} finally {
    await b.close();
}
