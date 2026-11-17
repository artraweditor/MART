// The editing tools of milestone 3 in headless Chrome: crop with real drags, ratio, quarter turn, undo, the Look,
// Info and Open sheets, spot white balance, Save.
//   node tests/ui_m3.mjs http://localhost:8080 outdir        (host started on a COPY of an image)
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const out = process.argv[3] ?? "/tmp";
const b = await launch({ out, window: process.env.WINDOW ?? "1180,820" });
const { js, shot } = b;
const $text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const click = (sel, text) => js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${text === undefined ? "true" : `x.textContent.trim() === ${JSON.stringify(text)}`}); if (!e) throw new Error("no ${sel} ${text ?? ""}"); e.click(); return true; })()`);
const params = () => js("window.__mart.params()");
const until = async (what, fn, ms = 20000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
try {
    await b.goto(base);
    await until("image loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));
    const { w: W, h: H } = await js("window.__mart.size()");
    console.log("image", W, "x", H);

    // a value beyond the slider's nominal range (this sidecar has +4.35 EV) is shown as it is
    assert.equal(await js(`(() => { const l=[...document.querySelectorAll(".ctl label")].find(x=>x.textContent==="Exposure"); return l.closest(".ctl").querySelector("output").textContent; })()`), "4.35");

    // ---- crop: drag the bottom-right corner, with the mouse --------------------------------------
    await click("#tabs button", "Crop");
    await sleep(500);
    assert.equal(await js(`document.getElementById("crop").hidden`), false, "overlay shown in the Crop tab");
    const se = await js(`window.__mart.toPage(${W}, ${H})`);
    await b.drag(se.x - 3, se.y - 3, se.x - 143, se.y - 183);
    await until("crop edit applied", async () => (await params()).Crop?.Enabled === true);
    let crop = (await params()).Crop;
    console.log("crop after drag:", crop.X, crop.Y, crop.W, crop.H);
    assert.equal(crop.X, 0); assert.equal(crop.Y, 0);
    assert.ok(crop.W < W - 100 && crop.H < H - 100, "the corner moved in");
    await shot("m3-1-crop.png");

    // ---- ratio 3:2 ---------------------------------------------------------------------------------
    await click(".croptool .chip", "3:2");
    await until("ratio applied", async () => (await params()).Crop?.Ratio === "3:2");
    crop = (await params()).Crop;
    assert.equal(crop.FixedRatio, true);
    assert.ok(Math.abs(crop.W / crop.H - 1.5) < 0.01 || Math.abs(crop.H / crop.W - 1.5) < 0.01, `ratio ${crop.W}x${crop.H}`);
    console.log("3:2 ->", crop.W, "x", crop.H, crop.Orientation);

    // dragging a corner now keeps the ratio
    const r1 = await js(`window.__mart.toPage(${crop.X + crop.W}, ${crop.Y + crop.H})`);
    await b.drag(r1.x, r1.y, r1.x - 60, r1.y - 10);
    await until("drag applied", async () => (await params()).Crop.W < crop.W);
    const c2 = (await params()).Crop;
    assert.ok(Math.abs(c2.W / c2.H - crop.W / crop.H) < 0.01, "the ratio holds while dragging");

    // ---- outside the Crop tab the view shows the cropped part --------------------------------------
    await click("#tabs button", "Tone");
    await until("cropped view", async () => { const bd = await js("window.__mart.bounds()"); return bd.w === c2.W && bd.h === c2.H && bd.x === c2.X; });
    assert.equal(await js(`document.getElementById("crop").hidden`), true);
    await sleep(2000);
    await shot("m3-2-cropped.png");

    // ---- quarter turn: size swaps, crop is dropped ----------------------------------------------------
    await click("#tabs button", "Crop");
    await click(".croptool .chip", "↻ 90°");
    await until("turned", async () => (await js("window.__mart.size()")).w === H);
    assert.equal((await params())["Coarse Transformation"].Rotate, 90);
    assert.equal((await params()).Crop.Enabled, false);
    await sleep(1500);
    await shot("m3-3-turned.png");
    // undo brings the old geometry and crop back
    await js(`document.getElementById("undo").click()`);
    await until("undone", async () => (await js("window.__mart.size()")).w === W);
    await until("crop back", async () => (await params()).Crop.Enabled === true);

    // ---- straighten ------------------------------------------------------------------------------------
    await js(`(() => { const l=[...document.querySelectorAll(".ctl label")].find(x=>x.textContent==="Straighten"); const i=l.closest(".ctl").querySelector("input"); i.value=4.5; i.dispatchEvent(new Event("input",{bubbles:true})); i.dispatchEvent(new Event("change",{bubbles:true})); })()`);
    await until("rotation applied", async () => (await params()).Rotation?.Degree === 4.5);

    // ---- spot white balance --------------------------------------------------------------------------------
    await click("#tabs button", "Color");
    await click(".chip", "Pick a neutral gray on the image");
    await sleep(300);
    const mid = await js(`(() => { const r = document.getElementById("view").getBoundingClientRect(); const bd = window.__mart.bounds(); return window.__mart.toPage(bd.x + bd.w / 2, bd.y + bd.h * 0.6); })()`);
    const t0 = (await params())["White Balance"].Temperature;
    await b.tap(mid.x, mid.y);
    await until("white balance set", async () => (await params())["White Balance"].Setting === "CustomTemp");
    console.log("spot WB: temperature", t0, "->", (await params())["White Balance"].Temperature);

    // ---- the Look sheet -----------------------------------------------------------------------------------
    await js(`document.getElementById("look").click()`);
    await until("profiles listed", () => js(`document.querySelectorAll(".looks .row-btn").length > 1`));
    await shot("m3-4-look.png");
    await click(".looks .row-btn", "Sharpening");
    await until("profile applied", async () => (await params()).Sharpening?.Enabled === true);
    assert.equal(await js(`document.getElementById("sheet").hidden`), true, "the sheet closes after choosing");

    // ---- the Info sheet ---------------------------------------------------------------------------------------
    await js(`document.getElementById("more").click()`);
    await click(".action", "Image information");
    await until("summary", () => js(`document.querySelectorAll("#sheet .facts dt").length > 4`));
    const facts = await js(`[...document.querySelectorAll("#sheet .facts dt, #sheet .facts dd")].map(e => e.textContent).join("|")`);
    assert.match(facts, /Camera\|SONY ILCE-7M4/);
    assert.match(facts, /Aperture\|f\/2\.8/);
    await shot("m3-5-info.png");
    await click(".subtabs .chip", "All metadata");
    await until("metadata", () => js(`document.querySelectorAll("#sheet .facts.tags dt").length > 50`));
    await js(`(() => { const i = document.querySelector(".sheet-body input[type=search]"); i.value = "lens"; i.dispatchEvent(new Event("input", {bubbles:true})); })()`);
    await until("filtered", () => js(`(() => { const n = document.querySelectorAll("#sheet .facts.tags dt").length; return n > 0 && n < 40; })()`));
    console.log("metadata rows for 'lens':", await js(`document.querySelectorAll("#sheet .facts.tags dt").length`));
    await shot("m3-6-metadata.png");

    // ---- open another image: refused while there are unsaved edits ----------------------------------------------
    await click(".subtabs .chip", "Summary");
    await click(".action", "Open another image…");
    const file = await js(`window.__mart && document.getElementById("title").textContent`);
    await js(`(() => { const i = document.querySelector(".sheet-body input[type=text]"); i.value = ${JSON.stringify(process.argv[4] ?? "")}; })()`);
    if (process.argv[4]) {
        await click(".action", "Open");
        await until("choice offered", () => js(`document.querySelector(".choice .action") !== null`));
        await shot("m3-7-unsaved.png");
        await click(".choice .action", "Save, then open");
        await until("reopened clean", () => js(`document.getElementById("sheet").hidden && document.getElementById("save").disabled`));
        console.log("reopened", file);
    }
    console.log("exceptions:", b.logs.length ? b.logs : "none");
    console.log("ui m3: ok");
} finally {
    b.close();
}
