// The Retouch tab: add a region, its sliders, the brush (painting with the mouse), several regions, removal; the
// sidecar's own color/tone regions stay where they are.   node tests/ui_retouch.mjs http://localhost:8080 outdir   (fresh host)
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: process.env.WINDOW ?? "1180,820" });
const { js, shot } = b;
const until = async (what, fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
const params = async () => (await (await fetch(base + "/api/params")).json()).params;
const tab = (name) => js(`[...document.querySelectorAll("#tabs button")].find(b => b.textContent === ${JSON.stringify(name)}).click()`);
const section = `#tools section:not([hidden])`;
const open = `${section} .tool-group.open`;
const setSlider = (label, v) => js(`(() => { const c = [...document.querySelectorAll("${open} .ctl")].find(c => c.querySelector("label")?.textContent === ${JSON.stringify(label)}); if (!c) throw new Error("no slider " + ${JSON.stringify(label)}); const i = c.querySelector("input"); i.value = ${v}; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const chip = (text) => js(`[...document.querySelectorAll("${open} .chip")].find(c => c.textContent.trim() === ${JSON.stringify(text)} && c.offsetParent !== null).click()`);
const addRegion = () => js(`[...document.querySelectorAll("${section} .chip")].find(c => c.textContent.trim() === "+ Add a region").click()`);
const ours = (p) => Object.fromEntries(Object.entries(p.ColorCorrection).filter(([k]) => /^MaskName_/.test(k)).map(([k, v]) => [k.slice(9), v]));
try {
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));
    const before = await params();
    const sidecar = ours(before);
    assert.equal(Object.keys(sidecar).length, 1, "the sidecar has one region of the tool: " + JSON.stringify(sidecar));
    await tab("Retouch");
    await sleep(300);
    assert.equal(await js(`document.querySelectorAll("${section} .tool-group").length`), 0, "no region yet");

    // a region, and its sliders
    await addRegion();
    await until("a region", async () => Object.keys((await params()).Retouch).length === 1);
    await until("region shown", () => js(`document.querySelectorAll("${section} .tool-group").length === 1`));
    assert.equal(await js(`document.querySelector("${open} .tool-toggle").textContent`), "Region 1");
    await setSlider("Highlights (gain)", 1);       // one stop: Slope 2
    await setSlider("Hue shift", 25);
    await setSlider("Shadows (lift)", 0.05);
    await setSlider("Midtones (gamma)", -1);       // Power 0.5
    await setSlider("Saturation", -40);
    await setSlider("Pivot", -2);
    await setSlider("Compression", 0.3);
    const r = await until("sliders", async () => { const v = Object.values((await params()).Retouch)[0]; return v.Slope === 2 && v.HueShift === 25 && v.Pivot === 0.25 && v.Power === 0.5 && v.OutSaturation === -40 && v.Offset === 0.05 && v.Compression === 0.3 && v; });
    assert.equal(r.Enabled, true);
    let p = await params();
    assert.equal(p.ColorCorrection.Enabled, true);
    assert.equal(ours(p)[1], sidecar[1], "the sidecar's region is first and unchanged");
    assert.equal(p.ColorCorrection["Mode_2"], "Jzazbz");
    assert.equal(p.ColorCorrection["Slope_1"], before.ColorCorrection["Slope_1"], "and so are its values");
    await shot("retouch-1-region.png");

    // the brush: off at first, then painting with the mouse
    assert.equal(await js(`document.querySelector("${open} .brush-box").hidden`), true);
    await chip("Brush mask");
    await until("brush on", async () => Object.values((await params()).Retouch)[0].BrushEnabled === true);
    assert.equal(await js(`document.querySelector("${open} .brush-box").hidden`), false);
    await setSlider("Opacity", 80);
    await setSlider("Feather", 10);
    await chip("Edit the mask");
    assert.equal(await js(`document.querySelector("${open} .edit-box").hidden`), false, "the mask is being edited");
    const rect = await js(`(() => { const r = document.getElementById("view").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const cx = rect.x + rect.w * 0.4, cy = rect.y + rect.h * 0.5;
    const zoomBefore = await js(`window.__mart.layout().zoom`);
    await b.drag(cx, cy, cx + 120, cy + 40, 12);
    await sleep(800);
    assert.equal(await js(`window.__mart.layout().zoom`), zoomBefore, "painting does not pan or zoom");
    assert.equal(Object.values((await params()).Retouch)[0].Strokes.length, 0, "nothing is sent before the commit");
    assert.match(await js(`document.querySelector("${open} .edit-box .muted").textContent`), /dabs painted/);
    await shot("retouch-2-brush.png");
    // erase, then take that stroke back (locally), then paint a second one
    await chip("Erase instead of paint");
    await b.drag(cx, cy, cx + 60, cy + 20, 6);
    await chip("Undo stroke");
    await chip("Erase instead of paint");
    await sleep(300);
    assert.equal(Object.values((await params()).Retouch)[0].Strokes.length, 0, "still nothing sent");
    // commit: the strokes are sent and the editing ends
    await chip("Commit");
    const st = await until("strokes", async () => { const v = Object.values((await params()).Retouch)[0]; return v.Strokes.length >= 1 && v; });
    assert.equal(await js(`document.querySelector("${open} .edit-box").hidden`), true, "editing ended");
    assert.equal(st.BrushOpacity, 80);
    assert.equal(st.BrushFeather, 10);
    assert.ok(st.Strokes.every((g) => g[1] === 1), "the undone erase stroke is not there");
    const dabs = st.Strokes.reduce((n, g) => n + (g.length - 3) / 2, 0);
    assert.ok(dabs > 5, "dabs along the drag: " + dabs);
    let p2 = await params();
    assert.equal(p2.ColorCorrection["DrawnMaskEnabled_2"], true);
    assert.equal(p2.ColorCorrection["DrawnMaskMode_2"], 0);
    // the stroke is at the place of the drag (fractions of the image)
    const g = st.Strokes[0];
    const xs = g.slice(3).filter((_, i) => i % 2 === 0), ys = g.slice(3).filter((_, i) => i % 2 === 1);
    assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 1 && Math.max(...xs) > Math.min(...xs), "x positions");
    assert.ok(Math.max(...ys) > Math.min(...ys), "y positions");
    // discarding drops what was painted since the edit began
    await chip("Edit the mask");
    await b.drag(cx, cy + 80, cx + 80, cy + 90, 6);
    await chip("Discard");
    await sleep(300);
    assert.equal(Object.values((await params()).Retouch)[0].Strokes.length, st.Strokes.length);
    // clear (committed too)
    await chip("Edit the mask");
    await chip("Clear");
    await chip("Commit");
    await until("cleared", async () => Object.values((await params()).Retouch)[0].Strokes.length === 0);
    // leaving the tab keeps what was painted
    await chip("Edit the mask");
    await b.drag(cx, cy, cx + 50, cy + 10, 5);
    await tab("Tone");
    await until("committed by leaving", async () => Object.values((await params()).Retouch)[0].Strokes.length >= 1);
    await tab("Retouch");
    await sleep(300);
    await chip("Edit the mask");
    await chip("Clear");
    await chip("Commit");
    await until("cleared again", async () => Object.values((await params()).Retouch)[0].Strokes.length === 0);

    // a second region: one open at a time, in order, after the first
    await addRegion();
    await until("two regions", async () => Object.keys((await params()).Retouch).length === 2);
    await until("second open", () => js(`document.querySelectorAll("${section} .tool-group.open").length === 1 && document.querySelector("${open} .tool-toggle").textContent === "Region 2"`));
    await setSlider("Saturation", 30);
    p = await params();
    assert.deepEqual(Object.values(ours(p)), [sidecar[1], "MART retouch 1", "MART retouch 2"]);
    assert.equal(p.ColorCorrection["OutSaturation_3"], 30);
    // switch it off: the tool stays on, the other is on
    await chip("Enabled");
    await until("off", async () => (await params()).Retouch["2"].Enabled === false);
    assert.equal((await params()).ColorCorrection.Enabled, true);
    assert.match(await js(`document.querySelector("${open} .tool-toggle").textContent`), /Region 2 \(off\)/);

    // the Other tab does not list them (the sidecar's own region may be there, off)
    await tab("Other");
    await sleep(300);
    const items = await js(`[...document.querySelectorAll("#tools section:not([hidden]) .other-item summary")].map(s => s.textContent.replace(/\\s+/g, " ").trim())`);
    assert.ok(!items.some((t) => /^Color\/tone correction\s*[2-9] regions$/.test(t)), "not ours: " + items);

    // removing a region
    await tab("Retouch");
    await sleep(200);
    await chip("Remove this region");
    await until("removed", async () => Object.keys((await params()).Retouch).join() === "1");
    p = await params();
    assert.deepEqual(Object.values(ours(p)), [sidecar[1], "MART retouch 1"]);
    await sleep(200);  // (the remaining region opens by itself)
    await chip("Remove this region");
    await until("all removed", async () => Object.keys((await params()).Retouch).length === 0);
    p = await params();
    assert.deepEqual(Object.values(ours(p)), [sidecar[1]]);
    // the sidecar had the tool off: its region stays off with it
    assert.equal(p.ColorCorrection.Enabled, false);
    assert.equal(p.ColorCorrection["MaskEnabled_1"], false);
    console.log("ui retouch: ok");
} finally {
    await b.close();
}
