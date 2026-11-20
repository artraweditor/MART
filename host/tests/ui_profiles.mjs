/*
 *
 *  This file is part of MART.
 *
 *  Copyright 2026 Alberto Griggio <alberto.griggio@gmail.com>
 *
 *  MART is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  MART is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with MART.  If not, see <http://www.gnu.org/licenses/>.
 */

// The Look sheet (MART's profiles, the star for the default) and the Save
// dialog (sections, name, replacing).
//   node tests/ui_profiles.mjs http://localhost:8080 outdir     (host started
// with its own --profiles DIR holding a profile
//                                                                named
// Sharpening, on a COPY of an image: use a fresh one)
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({
    out: process.argv[3] ?? "/tmp",
    window: process.env.WINDOW ?? "1180,820",
});
const { js, shot } = b;
const until = async (what, fn, ms = 15000) => {
    const t = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t > ms) throw new Error("timeout: " + what);
        await sleep(100);
    }
};
const params = async () =>
    (await (await fetch(base + "/api/params")).json()).params;
const profiles = async () => (await fetch(base + "/api/profiles")).json();
const sheetText = (sel) =>
    js(
        `[...document.querySelectorAll("#sheet ${sel}")].map(e => ` +
            `e.textContent.trim())`,
    );
const clickIn = (sel, text) =>
    js(
        `(() => { const e = [...document.querySelectorAll("#sheet ` +
            `${sel}")].find(x => x.textContent.trim() === ` +
            `${JSON.stringify(text)}); if (!e) throw new Error("no ${sel} " ` +
            `+ ` +
            `${JSON.stringify(text)}); e.click(); return true; })()`,
    );
const openLook = async () => {
    await js(`document.getElementById("profiles").click()`);
    await until("sheet", () =>
        js(
            `document.querySelector(".sheet-title")?.textContent === ` +
                `"Profiles" && document.querySelectorAll("#sheet ` +
                `.look-row").length > 0`,
        ),
    );
};
// the names in a group of the list (an uploaded profile of an earlier test may
// add a group of its own)
const group = (title) =>
    js(
        `(() => { const out = []; let on = false; for (const e of ` +
            `document.querySelectorAll("#sheet .looks > *")) { if (e.tagName ` +
            `=== "H3") on = e.textContent === ${JSON.stringify(title)}; else ` +
            `if (on && e.querySelector(".row-btn")) ` +
            `out.push(e.querySelector(".row-btn").textContent); } return ` +
            `out; ` +
            `})()`,
    );
const toast = () =>
    js(
        `document.getElementById("toast").hidden ? "" : ` +
            `document.getElementById("toast").textContent`,
    );
try {
    await b.goto(base);
    await until("loaded", () =>
        js(
            `document.getElementById("overlay").hidden && ` +
                `window.__mart?.size().w > 0`,
        ),
    );

    // ---- the list: MART's profiles and the built-in reset, nothing of ART's
    // ----------------------------------------
    await openLook();
    const titles = await sheetText(".looks h3");
    assert.ok(titles.includes("Reset") && titles.includes("My profiles"));
    assert.ok(
        !titles.some((t) => ["ART", "Yours", "Folder"].includes(t)),
        "nothing of ART's: " + titles,
    );
    assert.deepEqual(
        await group("Reset"),
        ["Neutral"],
        "no Default: that is ART's",
    );
    assert.deepEqual(await group("My profiles"), ["Sharpening"]);
    assert.equal(
        await js(`document.querySelectorAll("#sheet .star").length`),
        1,
        "a star for the profiles of MART only",
    );
    // the star: the default for pictures without a sidecar; one at most
    const star = `document.querySelector("#sheet .star")`;
    assert.equal(await js(`${star}.getAttribute("aria-pressed")`), "false");
    await js(`${star}.click()`);
    await until("star on", () =>
        js(`${star}.getAttribute("aria-pressed") === "true"`),
    );
    assert.equal(await js(`${star}.textContent`), "★");
    assert.deepEqual(
        (await profiles()).filter((p) => p.default).map((p) => p.name),
        ["Sharpening"],
    );
    await js(`${star}.click()`);
    await until("star off", () =>
        js(`${star}.getAttribute("aria-pressed") === "false"`),
    );
    assert.deepEqual(
        (await profiles()).filter((p) => p.default),
        [],
    );
    await shot("profiles-1-look.png");
    console.log("the list and the star: ok");

    // ---- saving -------------------------------------------------------------
    await js(`window.__mart && 0`);
    await clickIn(".action", "Save the current settings as a profile…");
    await until("save dialog", () =>
        js(
            `document.querySelector(".sheet-title")?.textContent === "Save a ` +
                `profile" && document.querySelectorAll("#sheet .sections ` +
                `.chip").length > 10`,
        ),
    );
    const labels = await sheetText(".sections .chip");
    for (const l of [
        "Exposure and highlight recovery",
        "Haze removal",
        "Contrast and tone curve",
        "Tone equalizer",
        "White balance",
        "Saturation and vibrance",
        "Primaries correction",
        "Soft light",
        "Film simulation",
        "Lens correction and flat field",
        "Capture sharpening",
        "Noise reduction",
        "Film grain",
        "Halation",
        "Retouching",
        "Crop and rotation",
    ])
        assert.ok(labels.includes(l), "a checkbox for " + l);
    const state = () =>
        js(
            `Object.fromEntries([...document.querySelectorAll("#sheet ` +
                `.sections .chip")].map(c => [c.textContent.trim(), ` +
                `c.getAttribute("aria-checked")]))`,
        );
    let st = await state();
    assert.equal(st["Exposure and highlight recovery"], "true");
    assert.equal(
        st["White balance"],
        "false",
        "white balance and the crop are of the image",
    );
    assert.equal(st["Crop and rotation"], "false");
    await shot("profiles-2-save.png");
    // a name is needed, and a section
    await clickIn(".action", "Save");
    assert.match(
        await js(
            `document.querySelector("#sheet .muted:last-of-type, #sheet ` +
                `.sheet-body > .muted:nth-last-of-type(1)")?.textContent ?? ` +
                `[...document.querySelectorAll("#sheet .muted")].map(e => ` +
                `e.textContent).join("|")`,
        ),
        /name/,
    );
    // edit something to save, check only two sections
    await js(`document.querySelector("#sheet .sheet-close").click()`);
    await js(
        `(() => { const c = [...document.querySelectorAll("#tools ` +
            `section:not([hidden]) .ctl")].find(c => ` +
            `c.querySelector("label")?.textContent === "Exposure"); const i ` +
            `= ` +
            `c.querySelector("input"); i.value = 0.6; i.dispatchEvent(new ` +
            `Event("input", { bubbles: true })); i.dispatchEvent(new ` +
            `Event("change", { bubbles: true })); })()`,
    );
    await until(
        "exposure",
        async () => (await params()).Exposure.Compensation === 0.6,
    );
    await openLook();
    await clickIn(".action", "Save the current settings as a profile…");
    await until("save dialog", () =>
        js(`document.querySelectorAll("#sheet .sections .chip").length > 10`),
    );
    for (const l of [
        "Haze removal",
        "Contrast and tone curve",
        "Tone equalizer",
        "Saturation and vibrance",
        "Primaries correction",
        "Soft light",
        "Film simulation",
        "Lens correction and flat field",
        "Capture sharpening",
        "Noise reduction",
        "Film grain",
        "Halation",
        "Retouching",
    ])
        await clickIn(".sections .chip", l); // off: only the exposure stays
    st = await state();
    assert.deepEqual(
        Object.entries(st)
            .filter(([, v]) => v === "true")
            .map(([k]) => k),
        ["Exposure and highlight recovery"],
    );
    await js(
        `(() => { const i = document.querySelector("#sheet ` +
            `input[type=text]"); i.value = "Bright"; i.dispatchEvent(new ` +
            `Event("input", { bubbles: true })); })()`,
    );
    await clickIn(".action", "Save");
    await until("saved", async () =>
        (await profiles()).some((p) => p.name === "Bright"),
    );
    await until("sheet closed", () =>
        js(`document.getElementById("sheet").hidden`),
    );
    assert.match(await toast(), /Saved the profile Bright/);
    console.log("saving: ok");

    // the name is taken: the button offers to replace it
    await openLook();
    await clickIn(".action", "Save the current settings as a profile…");
    await until("save dialog", () =>
        js(`document.querySelectorAll("#sheet .sections .chip").length > 10`),
    );
    await js(
        `(() => { const i = document.querySelector("#sheet ` +
            `input[type=text]"); i.value = "Bright"; i.dispatchEvent(new ` +
            `Event("input", { bubbles: true })); })()`,
    );
    await clickIn(".action", "Save");
    await until("replace offered", () =>
        js(
            `[...document.querySelectorAll("#sheet .action")].some(a => ` +
                `a.textContent === "Replace it")`,
        ),
    );
    assert.match((await sheetText(".muted")).join("|"), /already exists/);
    await clickIn(".action", "Replace it");
    await until("sheet closed", () =>
        js(`document.getElementById("sheet").hidden`),
    );
    assert.equal(
        (await profiles()).filter((p) => p.name === "Bright").length,
        1,
    );
    console.log("replacing: ok");

    // ---- applying what was saved --------------------------------------------
    await js(
        `(() => { const c = [...document.querySelectorAll("#tools ` +
            `section:not([hidden]) .ctl")].find(c => ` +
            `c.querySelector("label")?.textContent === "Exposure"); const i ` +
            `= ` +
            `c.querySelector("input"); i.value = -1; i.dispatchEvent(new ` +
            `Event("input", { bubbles: true })); i.dispatchEvent(new ` +
            `Event("change", { bubbles: true })); })()`,
    );
    await until(
        "exposure -1",
        async () => (await params()).Exposure.Compensation === -1,
    );
    await openLook();
    assert.deepEqual(await group("My profiles"), ["Bright", "Sharpening"]);
    await clickIn(".row-btn", "Bright");
    await until(
        "applied",
        async () => (await params()).Exposure.Compensation === 0.6,
    );
    assert.equal(await js(`document.getElementById("sheet").hidden`), true);
    console.log("applying: ok");

    // ---- renaming and deleting ----------------------------------------------
    const rowOf = (name) =>
        `(() => { const r = [...document.querySelectorAll("#sheet ` +
        `.look-row")].find(r => r.querySelector(".row-btn").textContent === ` +
        `${JSON.stringify(name)}); return r; })()`;
    const more = (name) => js(`${rowOf(name)}.querySelector(".more").click()`);
    const actionsOf = (name) =>
        js(
            `(() => { const r = ${rowOf(name)}; const a = ` +
                `r.nextElementSibling; return { hidden: a.hidden, text: ` +
                `[...a.querySelectorAll("button, span")].map(x => ` +
                `x.textContent.trim()) }; })()`,
        );
    await openLook();
    assert.deepEqual(
        await actionsOf("Bright"),
        { hidden: true, text: [] },
        "closed until the menu is opened",
    );
    await more("Bright");
    assert.deepEqual((await actionsOf("Bright")).text, ["Rename", "Delete"]);
    assert.equal((await actionsOf("Bright")).hidden, false);
    assert.equal((await group("My profiles")).length, 2, "two of mine");
    // rename: a field with the name, Enter or the button; a name that is taken
    // is refused
    await js(
        `(() => { const a = ${rowOf("Bright")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Rename").click(); })()`,
    );
    const field =
        `${rowOf("Bright")}.nextElementSibling.` + `querySelector("input")`;
    assert.equal(await js(`${field}.value`), "Bright");
    await js(`(() => { const i = ${field}; i.value = "Sharpening"; })()`);
    await js(
        `(() => { const a = ${rowOf("Bright")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Rename").click(); })()`,
    );
    await until("name taken", () =>
        js(
            `${rowOf("Bright")}.nextElementSibling.querySelector(".` +
                `look-message").textContent.includes("already exists")`,
        ),
    );
    assert.ok(
        (await profiles()).some((p) => p.name === "Bright"),
        "not renamed",
    );
    await js(`(() => { const i = ${field}; i.value = "Brighter"; })()`);
    await js(
        `(() => { const a = ${rowOf("Bright")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Rename").click(); })()`,
    );
    await until(
        "renamed",
        async () =>
            (await profiles()).some((p) => p.name === "Brighter") &&
            !(await profiles()).some((p) => p.name === "Bright"),
    );
    await until(
        "list shows it",
        async () =>
            (await group("My profiles")).join() === "Brighter,Sharpening",
    );
    assert.equal(
        await js(
            `document.querySelectorAll("#sheet ` +
                `.look-actions:not([hidden])").length`,
        ),
        0,
        "the list is drawn again",
    );
    await shot("profiles-3-renamed.png");
    // delete: asked again; Cancel keeps it; Delete removes it (and it is gone
    // from the folder)
    await more("Brighter");
    await js(
        `(() => { const a = ${rowOf("Brighter")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Delete").click(); })()`,
    );
    assert.deepEqual((await actionsOf("Brighter")).text, [
        "Delete Brighter?",
        "Delete",
        "Cancel",
    ]);
    await js(
        `(() => { const a = ${rowOf("Brighter")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Cancel").click(); })()`,
    );
    assert.deepEqual((await actionsOf("Brighter")).text, ["Rename", "Delete"]);
    assert.ok((await profiles()).some((p) => p.name === "Brighter"));
    await js(
        `(() => { const a = ${rowOf("Brighter")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Delete").click(); })()`,
    );
    await js(
        `(() => { const a = ${rowOf("Brighter")}.nextElementSibling; ` +
            `[...a.querySelectorAll("button")].find(x => x.textContent === ` +
            `"Delete").click(); })()`,
    );
    await until(
        "deleted",
        async () => !(await profiles()).some((p) => p.name === "Brighter"),
    );
    await until(
        "list without it",
        async () => (await group("My profiles")).join() === "Sharpening",
    );
    console.log("renaming and deleting: ok");
    console.log("renaming and deleting: ok");

    // ---- importing a profile from a file ------------------------------------
    const dir = mkdtempSync(join(tmpdir(), "mart-ui-"));
    const file = join(dir, "from disk.arp");
    writeFileSync(file, "[Saturation]\nEnabled=true\nSaturation=44\n");
    const notProfile = join(dir, "notes.arp");
    writeFileSync(notProfile, "this is not a profile\n");
    await openLook();
    await clickIn(".action", "Import a profile…");
    await until("import dialog", () =>
        js(
            `document.querySelector(".sheet-title")?.textContent === "Import ` +
                `a profile"`,
        ),
    );
    const importBtn =
        `[...document.querySelectorAll("#sheet ` +
        `.action")].find(a => a.textContent === "Import")`;
    assert.equal(
        await js(`${importBtn}.disabled`),
        true,
        "nothing to import yet",
    );
    await b.setFiles("#sheet input[type=file]", [file]);
    await until("name proposed", () =>
        js(
            `document.querySelector("#sheet input[type=text]").value === ` +
                `"from disk"`,
        ),
    );
    assert.equal(await js(`${importBtn}.disabled`), false);
    // the name can be set
    await js(
        `(() => { const i = document.querySelector("#sheet ` +
            `input[type=text]"); i.value = "Disk look"; i.dispatchEvent(new ` +
            `Event("input", { bubbles: true })); })()`,
    );
    await js(`${importBtn}.click()`);
    await until("imported", async () =>
        (await profiles()).some(
            (p) => p.name === "Disk look" && p.source === "mine",
        ),
    );
    await until("sheet closed", () =>
        js(`document.getElementById("sheet").hidden`),
    );
    assert.match(await toast(), /Imported the profile Disk look/);
    // it is in the list and can be applied
    await openLook();
    assert.ok((await group("My profiles")).includes("Disk look"));
    await clickIn(".row-btn", "Disk look");
    await until(
        "applied",
        async () => (await params()).Saturation.Saturation === 44,
    );
    // the same name again: refused, the name stays to be changed; a file that
    // is not a profile is refused too
    await openLook();
    await clickIn(".action", "Import a profile…");
    await b.setFiles("#sheet input[type=file]", [file]);
    await until("name proposed", () =>
        js(
            `document.querySelector("#sheet input[type=text]").value === ` +
                `"from disk"`,
        ),
    );
    await js(
        `(() => { const i = document.querySelector("#sheet ` +
            `input[type=text]"); i.value = "Disk look"; i.dispatchEvent(new ` +
            `Event("input", { bubbles: true })); })()`,
    );
    await js(`${importBtn}.click()`);
    await until("name taken", () =>
        js(
            `[...document.querySelectorAll("#sheet .muted")].some(p => ` +
                `p.textContent.includes("already exists"))`,
        ),
    );
    assert.equal(
        await js(`document.getElementById("sheet").hidden`),
        false,
        "the dialog stays",
    );
    await b.setFiles("#sheet input[type=file]", [notProfile]);
    await until("another file", () =>
        js(
            `document.querySelector("#sheet input[type=text]").value === ` +
                `"notes"`,
        ),
    );
    await js(`${importBtn}.click()`);
    await until("not a profile", () =>
        js(
            `[...document.querySelectorAll("#sheet .muted")].some(p => ` +
                `p.textContent.includes("does not look like"))`,
        ),
    );
    assert.ok(!(await profiles()).some((p) => p.name === "notes"));
    console.log("importing: ok");
    console.log("ui profiles: ok");
} finally {
    await b.close();
}
