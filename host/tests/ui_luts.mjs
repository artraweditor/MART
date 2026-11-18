// The film simulation's LUT drop-down and the Manage LUTs sheet: import (with a name), rename, delete.
//   node tests/ui_luts.mjs http://localhost:8080 outdir     (a fresh host with its own --luts DIR that holds sigmoid.ctl)
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: process.env.WINDOW ?? "1180,820" });
const { js, shot } = b;
const until = async (what, fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
const params = async () => (await (await fetch(base + "/api/params")).json()).params;
const luts = async () => (await (await fetch(base + "/api/luts")).json()).map((l) => l.name);
const section = `#tools section:not([hidden])`;
const sel = `document.querySelector("${section} .lut-select")`;
const options = () => js(`[...${sel}.options].map(o => o.textContent)`);
const sheetButton = (text) => js(`[...document.querySelectorAll("#sheet button")].find(x => x.textContent.trim() === ${JSON.stringify(text)})`).then(() => true);
const clickIn = (selector, text) => js(`(() => { const e = [...document.querySelectorAll("#sheet ${selector}")].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) throw new Error("no ${selector} " + ${JSON.stringify(text)}); e.click(); return true; })()`);
const dir = mkdtempSync(join(tmpdir(), "mart-ui-"));
const script = `// @ART-param: ["gain", "Gain", -1.0, 1.0, 0.5, 0.1]
void ART_main(varying float r, varying float g, varying float b, output varying float rout, output varying float gout, output varying float bout, float gain)
{ rout = r * (1 + gain); gout = g; bout = b; }
`;
const file = join(dir, "Teal Orange.CTL");
writeFileSync(file, script);
const setText = (value) => js(`(() => { const i = document.querySelector("#sheet input[type=text]"); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
try {
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));
    await js(`[...document.querySelectorAll("#tabs button")].find(x => x.textContent === "Color").click()`);
    await js(`[...document.querySelectorAll("${section} .tool-heading")].find(h => h.textContent === "Film simulation").scrollIntoView()`);
    await until("LUTs listed", () => js(`${sel}.options.length > 1`));
    assert.deepEqual(await options(), ["None", "sigmoid.ctl"]);
    const manage = `[...document.querySelectorAll("${section} .clut .chip")].find(c => c.textContent === "Manage LUTs…")`;
    assert.ok(await js(`${manage} !== undefined`), "a Manage LUTs button");

    // ---- import, with a name -----------------------------------------------------------------------------------------------
    await js(`${manage}.click()`);
    await until("sheet", () => js(`document.querySelector(".sheet-title")?.textContent === "LUTs" && document.querySelectorAll("#sheet .look-row").length > 0`));
    assert.deepEqual(await js(`[...document.querySelectorAll("#sheet .lut-name")].map(e => e.textContent)`), ["sigmoid.ctl"]);
    await shot("luts-1-manage.png");
    await clickIn(".action", "Import a LUT…");
    await until("import dialog", () => js(`document.querySelector(".sheet-title")?.textContent === "Import a LUT"`));
    await b.setFiles("#sheet input[type=file]", [file]);
    await until("name proposed", () => js(`document.querySelector("#sheet input[type=text]").value === "Teal Orange"`));   // without the extension
    await setText("Teal");
    await clickIn(".action", "Import");
    await until("imported", async () => (await luts()).includes("Teal.CTL"));   // the extension of the file stays
    await until("back in the list", () => js(`document.querySelector(".sheet-title")?.textContent === "LUTs" && [...document.querySelectorAll("#sheet .lut-name")].some(e => e.textContent === "Teal.CTL")`));
    // the same name again: refused, the dialog stays
    await clickIn(".action", "Import a LUT…");
    await b.setFiles("#sheet input[type=file]", [file]);
    await until("name proposed", () => js(`document.querySelector("#sheet input[type=text]").value === "Teal Orange"`));
    await setText("Teal");
    await clickIn(".action", "Import");
    await until("name taken", () => js(`[...document.querySelectorAll("#sheet .muted")].some(p => p.textContent.includes("already exists"))`));
    await setText("Orange");
    await clickIn(".action", "Import");
    await until("second import", async () => (await luts()).includes("Orange.CTL"));
    await until("list", () => js(`document.querySelector(".sheet-title")?.textContent === "LUTs"`));

    // ---- rename and delete ----------------------------------------------------------------------------------------------------------
    const row = (name) => `[...document.querySelectorAll("#sheet .look-row")].find(r => r.querySelector(".lut-name").textContent === ${JSON.stringify(name)})`;
    const menuButton = (name, text) => js(`[...${row(name)}.nextElementSibling.querySelectorAll("button")].find(x => x.textContent === ${JSON.stringify(text)}).click()`);
    await js(`${row("Teal.CTL")}.querySelector(".more").click()`);
    await menuButton("Teal.CTL", "Rename");
    assert.equal(await js(`${row("Teal.CTL")}.nextElementSibling.querySelector("input").value`), "Teal", "the name without the extension");
    await js(`(() => { ${row("Teal.CTL")}.nextElementSibling.querySelector("input").value = "Orange"; })()`);
    await menuButton("Teal.CTL", "Rename");
    await until("name taken", () => js(`${row("Teal.CTL")}.nextElementSibling.querySelector(".look-message").textContent.includes("already exists")`));
    await js(`(() => { ${row("Teal.CTL")}.nextElementSibling.querySelector("input").value = "Teal Look"; })()`);
    await menuButton("Teal.CTL", "Rename");
    await until("renamed", async () => (await luts()).includes("Teal Look.CTL") && !(await luts()).includes("Teal.CTL"));
    await until("list drawn", () => js(`[...document.querySelectorAll("#sheet .lut-name")].some(e => e.textContent === "Teal Look.CTL")`));
    await js(`${row("Orange.CTL")}.querySelector(".more").click()`);
    await menuButton("Orange.CTL", "Delete");
    assert.match(await js(`${row("Orange.CTL")}.nextElementSibling.textContent`), /Delete Orange\.CTL\?/);
    await menuButton("Orange.CTL", "Delete");
    await until("deleted", async () => !(await luts()).includes("Orange.CTL"));
    await shot("luts-2-managed.png");

    // ---- the drop-down follows: pick the LUT, then rename it under the film simulation's feet ----------------------------------------
    await js(`document.querySelector("#sheet .sheet-close").click()`);
    await until("options refreshed", async () => (await options()).join() === "None,sigmoid.ctl,Teal Look.CTL");
    const pick = (text) => js(`(() => { const s = ${sel}; const o = [...s.options].find(o => o.textContent === ${JSON.stringify(text)}); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await pick("Teal Look.CTL");
    await until("applied", async () => { const f = (await params())["Film Simulation"]; return f.Enabled === true && decodeURIComponent(f.ClutFilename).endsWith("/Teal Look.CTL"); });
    assert.equal(await js(`${sel}.selectedOptions[0].textContent`), "Teal Look.CTL");
    await until("its parameter", () => js(`[...document.querySelectorAll("${section} .ctl label")].some(l => l.textContent === "Gain")`));
    // deleting the LUT in use: it is no longer in the folder, and the drop-down says so
    await js(`${manage}.click()`);
    await until("sheet", () => js(`document.querySelectorAll("#sheet .look-row").length > 1`));
    await js(`${row("Teal Look.CTL")}.querySelector(".more").click()`);
    await menuButton("Teal Look.CTL", "Delete");
    await menuButton("Teal Look.CTL", "Delete");
    await until("deleted", async () => !(await luts()).includes("Teal Look.CTL"));
    await js(`document.querySelector("#sheet .sheet-close").click()`);
    await until("other location", async () => /not in MART's folder/.test(await js(`${sel}.selectedOptions[0].textContent`)));
    console.log("ui luts: ok");
} finally {
    await b.close();
}
