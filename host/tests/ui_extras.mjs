// Film grain, halation, film simulation (a CTL script and its parameters) and the Other tab, in the browser.
//   node tests/ui_extras.mjs http://localhost:8080 outdir        (host started on a COPY of an image; use a fresh one)
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: process.env.WINDOW ?? "1180,820" });
const { js, shot } = b;
const until = async (what, fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
const params = async () => (await (await fetch(base + "/api/params")).json()).params;
const tab = (name) => js(`[...document.querySelectorAll("#tabs button")].find(b => b.textContent === ${JSON.stringify(name)}).click()`);
const section = `#tools section:not([hidden])`;
// `after`: the heading of the section, when several sliders have the same label
const setSlider = (label, v, after) => js(`(() => { let all = [...document.querySelectorAll("${section} .ctl, ${section} .tool-heading")]; const at = ${JSON.stringify(after ?? "")}; if (at) all = all.slice(all.findIndex(e => e.classList.contains("tool-heading") && e.textContent === at)); const c = all.find(c => c.querySelector?.("label")?.textContent === ${JSON.stringify(label)} && !c.hidden); if (!c) throw new Error("no slider " + ${JSON.stringify(label)}); const i = c.querySelector("input"); i.value = ${v}; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const labels = () => js(`[...document.querySelectorAll("${section} .ctl")].filter(c => !c.hidden && c.querySelector("input[type=range]")).map(c => c.querySelector("label").textContent)`);
const chip = (text) => js(`[...document.querySelectorAll("${section} .chip")].find(c => c.textContent.trim() === ${JSON.stringify(text)} && c.offsetParent !== null).click()`);
// open the group of that heading (the others fold away) and bring it into view
const scrollTo = (text) => js(`(() => { const h = [...document.querySelectorAll("${section} .tool-heading")].find(h => h.textContent === ${JSON.stringify(text)}); if (!h.parentElement.classList.contains("open")) h.querySelector("button").click(); h.scrollIntoView(); })()`);
try {
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));

    // ---- film grain and halation (Detail) ------------------------------------------------------------------
    await tab("Detail");
    await scrollTo("Film grain");
    await setSlider("Coarseness (ISO)", 1600);
    await until("grain", async () => { const g = (await params()).Grain; return g.Enabled === true && g.ISO === 1600; });
    // the switch follows: the slider turned the tool on
    assert.equal(await js(`[...document.querySelectorAll("${section} .chip")].filter(c => c.textContent === "Enabled").map(c => c.getAttribute("aria-checked")).join()`).then((s) => s.split(",").includes("true")), true);
    await setSlider("Strength", 20, "Film grain");
    await until("grain strength", async () => (await params()).Grain.Strength === 20);
    await scrollTo("Halation");
    const before = await params();
    await setSlider("Tint", -0.2, "Halation");
    const h = await until("halation", async () => { const p = await params(); return p.Halation.Enabled && p.Halation.Tint === -0.2 && p; });
    assert.equal(h.Smoothing.Enabled, true);
    const names = Object.entries(h.Smoothing).filter(([k, v]) => /^MaskName_/.test(k) && v === "MART halation");
    assert.equal(names.length, 1, "one halation region");
    assert.equal(h.Smoothing["Mode_1"], before.Smoothing["Mode_1"], "the sidecar's region is where it was");
    await setSlider("Strength", 2.5, "Halation");
    await until("halation strength", async () => (await params()).Halation.Strength === 2.5);
    assert.equal(Object.keys((await params()).Smoothing).filter((k) => /^Mode_/.test(k)).length, Object.keys(before.Smoothing).filter((k) => /^Mode_/.test(k)).length + 1, "still one added region");
    await shot("extras-1-detail.png");
    console.log("grain, halation: ok");

    // ---- film simulation (Color) ----------------------------------------------------------------------------
    await tab("Color");
    await scrollTo("Film simulation");
    await sleep(200);
    const sel = `document.querySelector("${section} .lut-select")`;
    const pick = (text) => js(`(() => { const s = ${sel}; const o = [...s.options].find(o => o.textContent === ${JSON.stringify(text)}); if (!o) throw new Error("no LUT " + ${JSON.stringify(text)}); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    const picked = () => js(`${sel}.selectedOptions[0].textContent`);
    await until("LUTs listed", () => js(`${sel}.options.length > 1`));
    assert.deepEqual(await js(`[...${sel}.options].map(o => o.textContent)`), ["None", "sigmoid.ctl"], "the LUTs of MART's folder, and none");
    assert.equal(await picked(), "None");
    await shot("extras-2-luts.png");
    await pick("sigmoid.ctl");
    await until("LUT applied", async () => { const f = (await params())["Film Simulation"]; return f.Enabled === true && /sigmoid\.ctl$/.test(decodeURIComponent(f.ClutFilename)) && f; });
    assert.equal(await picked(), "sigmoid.ctl");
    // the parameters of the script, with the labels translated
    await until("parameters", async () => (await labels()).includes("Skew"));
    const ls = await labels();
    assert.ok(ls.includes("Contrast"), "labels come from the translations: " + ls);
    assert.ok(!ls.some((l) => l.startsWith("$") || /^[A-Z_]{6,}$/.test(l)), "no untranslated key: " + ls);
    await shot("extras-3-clut.png");
    await setSlider("Skew", 0.3);
    const f = await until("parameter written", async () => { const v = (await params())["Film Simulation"].ClutParams; return /contrast_skewness=0\.3/.test(v) && v; });
    assert.match(f, /white_point=/, "every parameter is written");
    await setSlider("Strength", 60, "Film simulation");
    await until("strength", async () => (await params())["Film Simulation"].Strength === 60);
    // reset: the script's defaults
    await chip("Reset");
    await until("reset", async () => (await params())["Film Simulation"].ClutParams === "");
    await sleep(300);
    assert.ok((await labels()).includes("Skew"), "the controls stay");
    // none
    await pick("None");
    await until("no LUT", async () => { const f2 = (await params())["Film Simulation"]; return f2.ClutFilename === "" && f2.Enabled === false; });
    await until("controls gone", async () => !(await labels()).includes("Skew"));
    assert.equal(await picked(), "None");
    console.log("film simulation: ok");

    // ---- the Other tab -----------------------------------------------------------------------------------------
    await tab("Other");
    await sleep(300);
    const items = await js(`[...document.querySelectorAll("${section} .other-item summary")].map(s => s.textContent.replace(/\\s+/g, " ").trim())`);
    console.log("other:", items.join(" | "));
    assert.ok(items.some((t) => t.startsWith("Noise reduction")), "the sidecar's denoise is listed");
    assert.ok(items.some((t) => /^Smoothing\s*1 region$/.test(t)), "the sidecar's smoothing region, not the halation: " + items);
    assert.ok(!items.some((t) => /Exposure|Grain|Halation|Tone/.test(t)), "tools with controls are not listed");
    await js(`document.querySelector("${section} .other-item").open = true`);
    await shot("extras-4-other.png");
    console.log("other tab: ok");
    console.log("ui extras: ok");
} finally {
    await b.close();
}
