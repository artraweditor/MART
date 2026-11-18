// The tone curve editor and the other tools in the browser.
//   node tests/ui_tools.mjs http://localhost:8080 outdir        (host started on a COPY of an image; nothing is saved)
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: process.env.WINDOW ?? "1180,820" });
const { js, shot } = b;
const until = async (what, fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
const params = async () => (await (await fetch(base + "/api/params")).json()).params;
const tab = (name) => js(`[...document.querySelectorAll("#tabs button")].find(b => b.textContent === ${JSON.stringify(name)}).click()`);
const nums = (s) => String(s).split(";").filter(Boolean).map(Number);
// the visible range inputs of the open tab, by label
const sliders = () => js(`[...document.querySelectorAll("#tools section:not([hidden]) .ctl")].filter(c => !c.hidden && c.querySelector("input[type=range]")).map(c => c.querySelector("label").textContent)`);
const setSlider = (label, v) => js(`(() => { const c = [...document.querySelectorAll("#tools section:not([hidden]) .ctl")].find(c => c.querySelector("label")?.textContent === ${JSON.stringify(label)} && !c.hidden); const i = c.querySelector("input"); i.value = ${v}; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const chip = (text) => js(`[...document.querySelectorAll("#tools section:not([hidden]) .chip")].find(c => c.textContent.trim() === ${JSON.stringify(text)} && c.offsetParent !== null).click()`);
const visibleChips = () => js(`[...document.querySelectorAll("#tools section:not([hidden]) .chip")].filter(c => c.offsetParent !== null).map(c => c.textContent.trim())`);
try {
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));

    // ---- the tone curve --------------------------------------------------------------------------------------
    await tab("Tone");
    await js(`document.querySelector("canvas.curve").scrollIntoView({ block: "center" })`);
    await sleep(300);
    // the image may come with a curve: reset it first
    await js(`document.querySelector(".curve-ctl .reset").click()`);
    await until("curve reset", async () => (await params()).ToneCurve.Curve === "0;");
    await js(`(() => { const h = [...document.querySelectorAll(".tool-heading")].find(h => h.textContent === "Contrast and curve"); if (!h.parentElement.classList.contains("open")) h.querySelector("button").click(); })()`);
    await sleep(200);
    const at = async (x, y) => js(`(() => { const r = document.querySelector("canvas.curve").getBoundingClientRect(), s = r.width, pad = 12; return { x: r.left + pad + ${x} * (s - 2 * pad), y: r.top + s - pad - ${y} * (s - 2 * pad) }; })()`);
    const a = await at(0.5, 0.5), a2 = await at(0.5, 0.7);
    await b.drag(a.x, a.y, a2.x, a2.y);
    const c = await until("a point was added and moved", async () => { const v = nums((await params()).ToneCurve.Curve); return v.length === 7 && v; });
    assert.equal(c[0], 1);
    assert.ok(Math.abs(c[3] - 0.5) < 0.03 && Math.abs(c[4] - 0.7) < 0.03, "the point is at (0.5, 0.7): " + c);
    assert.equal((await params()).ToneCurve.Enabled, true);
    assert.equal((await params()).ToneCurve.CurveMode, "Neutral", "the curve is applied in Neutral mode");
    await shot("tools-1-curve.png");
    // moving the end point changes only its y
    const e0 = await at(1, 1), e1 = await at(1, 0.9);
    await b.drag(e0.x, e0.y, e1.x, e1.y);
    const c2 = await until("end moved", async () => { const v = nums((await params()).ToneCurve.Curve); return v.length === 7 && Math.abs(v[6] - 0.9) < 0.03 && v; });
    assert.equal(c2[5], 1, "the end keeps x = 1");
    // "Remove point" needs a selected inner point; a double tap deletes
    await b.tap(a2.x, a2.y);
    await sleep(150);
    await b.tap(a2.x, a2.y);
    const c3 = await until("the point was deleted", async () => nums((await params()).ToneCurve.Curve).length === 5);
    // reset
    await js(`document.querySelector(".curve-ctl .reset").click()`);
    await until("curve reset", async () => (await params()).ToneCurve.Curve === "0;");
    // one undo step per drag: undo brings back the curve before the reset
    console.log("tone curve: ok");

    // ---- tone equalizer and soft light -----------------------------------------------------------------------
    await setSlider("Shadows", 30);
    await until("band", async () => (await params()).ToneEqualizer.Band1 === 30);
    console.log("tone equalizer: ok");

    // ---- haze removal: one slider for the whole dehaze tool -----------------------------------------------------
    await setSlider("Haze removal", 40);
    const hz = await until("dehaze on", async () => { const d = (await params()).Dehaze; return d.Enabled === true && d; });
    const level = hz.Strength.split(";").filter(Boolean).map(Number);
    assert.ok(level.length === 9 && Math.abs(level[2] - 0.7) < 1e-6 && Math.abs(level[6] - 0.7) < 1e-6, "a straight line at 0.5 + 40/200: " + hz.Strength);
    assert.equal(hz.Luminance, false, "RGB mode");
    // it keeps its value when the new frame and the parameters come back (it used to jump to zero)
    await sleep(1500);
    const hazeInput = () => js(`(() => { const c = [...document.querySelectorAll("#tools section:not([hidden]) .ctl")].find(c => c.querySelector("label")?.textContent === "Haze removal"); return { value: c.querySelector("input").value, shown: c.querySelector("output").textContent }; })()`);
    assert.deepEqual(await hazeInput(), { value: "40", shown: "40" });
    await setSlider("Haze removal", -30);
    await until("haze added", async () => Math.abs(Number((await params()).Dehaze.Strength.split(";")[2]) - 0.35) < 1e-6);
    await setSlider("Haze removal", 0);
    await until("dehaze off at zero", async () => (await params()).Dehaze.Enabled === false);
    console.log("haze removal: ok");

    // ---- channel mixer ----------------------------------------------------------------------------------------
    await tab("Color");
    await js(`(() => { const h = [...document.querySelectorAll(".tool-heading")].find(h => h.textContent.startsWith("Primaries correction")); if (!h.parentElement.classList.contains("open")) h.querySelector("button").click(); h.scrollIntoView(); })()`);
    const l = await sliders();
    assert.deepEqual(l.filter((x) => /hue|saturation/.test(x)).length, 6, "the six primaries sliders: " + l);
    assert.ok(!l.some((x) => /from/.test(x)), "no matrix");
    await setSlider("Green hue", -25);
    await until("hue tweak", async () => nums((await params())["Channel Mixer"].HueTweak).join() === "0,-25,0");
    await shot("tools-2-mixer.png");
    console.log("channel mixer: ok");

    // ---- soft light (also on the Color tab) ----------------------------------------------------------------
    await js(`(() => { const h = [...document.querySelectorAll(".tool-heading")].find(h => h.textContent === "Soft light"); if (!h.parentElement.classList.contains("open")) h.querySelector("button").click(); })()`);
    await chip("Enabled");
    await until("soft light on", async () => (await params()).SoftLight.Enabled === true);
    await setSlider("Strength", 55);
    await until("soft light strength", async () => (await params()).SoftLight.Strength === 55);
    console.log("soft light: ok");

    // ---- detail: lens and sharpening ---------------------------------------------------------------------------
    await tab("Detail");
    let chips = await visibleChips();
    assert.ok(!chips.includes("Distortion") || (await params()).LensProfile.LcMode !== "none", "lens options only with a source");
    await chip("Off");
    await until("lens off", async () => (await params()).LensProfile.LcMode === "none");
    assert.ok(!(await visibleChips()).includes("Chromatic aberration"), "no options while off");
    await chip("Automatic");
    await until("lens auto", async () => (await params()).LensProfile.LcMode === "lfauto");
    assert.ok((await visibleChips()).includes("Chromatic aberration"));
    await chip("Chromatic aberration");
    await until("CA", async () => (await params()).LensProfile.UseCA === true);
    // the embedded flat field: checking it turns the flat field on, unchecking leaves the rest
    const ffChecked = () => js(`[...document.querySelectorAll("#tools section:not([hidden]) .chip")].find(c => c.textContent.trim() === "Use the embedded flat field, if any").getAttribute("aria-checked")`);
    assert.equal(await ffChecked(), "false", "off for a raw that is not a DNG");
    await chip("Use the embedded flat field, if any");
    await until("flat field on", async () => { const r = (await params()).RAW; return r.FlatFieldEnabled === true && r.FlatFieldUseEmbedded === true; });
    assert.equal(await ffChecked(), "true");
    await chip("Use the embedded flat field, if any");
    await until("flat field off", async () => (await params()).RAW.FlatFieldUseEmbedded === false);
    console.log("embedded flat field: ok");
    await chip("Embedded");
    await until("lens exif", async () => (await params()).LensProfile.LcMode === "exif");
    await setSlider("Radius", 1.1);
    const S = await until("sharpening", async () => { const s = (await params()).Sharpening; return s.Enabled && s.DeconvRadius === 1.1 && s; });
    assert.equal(S.Method, "rld");
    assert.equal(S.DeconvAutoRadius, false, "never the automatic radius");
    await setSlider("Amount", 60);
    await setSlider("Contrast threshold", 35);
    await until("amount, contrast", async () => { const s = (await params()).Sharpening; return s.DeconvAmount === 60 && s.Contrast === 35; });
    await js(`(() => { const h = [...document.querySelectorAll(".tool-heading")].find(h => h.textContent === "Capture sharpening"); if (!h.parentElement.classList.contains("open")) h.querySelector("button").click(); })()`);
    await chip("Enabled");  // the switch, now on
    await until("sharpening off", async () => (await params()).Sharpening.Enabled === false);
    await shot("tools-3-detail.png");
    // ---- noise reduction presets ----------------------------------------------------------------------------
    await js(`(() => { const h = [...document.querySelectorAll(".tool-heading")].find(h => h.textContent === "Noise reduction"); if (!h.parentElement.classList.contains("open")) h.querySelector("button").click(); })()`);
    const nrChip = (t) => js(`[...document.querySelectorAll("#tools section:not([hidden]) .tool-group.open .chip")].find(c => c.textContent === ${JSON.stringify(t)}).click()`);
    await nrChip("Medium");
    const d = await until("medium denoise", async () => { const v = (await params()).Denoise; return v.Enabled === true && v.Luminance === 15 && v; });
    assert.equal(d.SmoothingEnabled, true);
    await nrChip("Low");
    await until("low denoise", async () => { const v = (await params()).Denoise; return v.Luminance === 0 && v.SmoothingEnabled === false && v.ChrominanceAutoFactor === 0.5; });
    await nrChip("High");
    await until("high denoise", async () => { const v = (await params()).Denoise; return v.Luminance === 30 && v.ChrominanceAutoFactor === 0.7; });
    await nrChip("Off");
    await until("denoise off", async () => (await params()).Denoise.Enabled === false);
    console.log("noise reduction: ok");
    console.log("lens, sharpening: ok");

    console.log("ui tools: ok");
} finally {
    await b.close();
}
