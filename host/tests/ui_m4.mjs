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

// Export in the browser: the sheet, the busy state, the download.
//   node tests/ui_m4.mjs http://localhost:8080 outdir        (host started on
// an image; exporting only writes a temp folder)
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const out = process.argv[3] ?? "/tmp";
const b = await launch({ out, window: process.env.WINDOW ?? "1180,820" });
const { js, shot } = b;
const click = (sel, text) =>
    js(
        `(() => { const e = ` +
            `[...document.querySelectorAll(${JSON.stringify(sel)})].find(x ` +
            `=> ` +
            `${
                text === undefined
                    ? "true"
                    : `x.textContent.trim() === ${JSON.stringify(text)}`
            }); if ` +
            `(!e) throw new Error("no ${sel} ${text ?? ""}"); e.click(); ` +
            `return true; })()`,
    );
const until = async (what, fn, ms = 60000) => {
    const t = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t > ms) throw new Error("timeout: " + what);
        await sleep(100);
    }
};
const checked = (text) =>
    js(
        `[...document.querySelectorAll(".sheet-body .chip")].find(x => ` +
            `x.textContent.trim() === ` +
            `${JSON.stringify(text)})?.getAttribute("aria-checked")`,
    );
try {
    await js("localStorage.clear()").catch(() => {});
    await b.goto(base);
    await until("loaded", () =>
        js(
            `document.getElementById("overlay").hidden && ` +
                `window.__mart?.size().w > 0`,
        ),
    );
    await js("localStorage.removeItem('mart.export')");
    const stem = (await js(`document.getElementById("title").textContent`))
        .replace(/\.[^.]*$/, "")
        .replace(/ ·.*$/, "");

    // ---- the sheet, with the format's own options ---------------------------
    await js(`document.getElementById("export").click()`);
    await until("export sheet", () =>
        js(`document.querySelector(".sheet-title")?.textContent === "Export"`),
    );
    assert.equal(await checked("JPEG"), "true", "JPEG by default");
    assert.equal(
        await js(
            `document.querySelector(".sheet-body input[type=range]") !== null`,
        ),
        true,
        "JPEG has a quality slider",
    );
    assert.equal(
        await js(
            `document.querySelector(".sheet-body ` +
                `input[type=text]").placeholder`,
        ),
        stem,
        "the image's name is the default",
    );
    await click(".chip", "TIFF");
    assert.equal(
        await js(`document.querySelector(".sheet-body input[type=range]")`),
        null,
        "no quality for TIFF",
    );
    assert.equal(await checked("16 bit"), "true");
    await click(".chip", "ZIP");
    // the sizes: full size is the default; the others are resizes
    assert.deepEqual(
        await js(
            `[...document.querySelectorAll(".sheet-body .chip")].map(c => ` +
                `c.textContent).filter(t => /px|Full/.test(t))`,
        ),
        ["Full size", "1920 px", "2560 px", "3840 px"],
    );
    assert.equal(await checked("Full size"), "true");
    assert.equal(
        await js(`document.querySelector(".sheet-body .muted")`),
        null,
        "no note about the fast pipeline at full size",
    );
    await click(".chip", "1920 px");
    assert.match(
        await js(`document.querySelector(".sheet-body .muted").textContent`),
        /at most 1920 px.*fast export/,
    );
    await js(
        `(() => { const i = document.querySelector(".sheet-body ` +
            `input[type=text]"); i.value = "ui export"; })()`,
    );
    await shot("m4-2-options.png");

    // ---- exporting: busy while it runs, then a download ---------------------
    await click(".action", "Export");
    await until("progress shown", () =>
        js(`document.querySelector(".export-progress .spinner") !== null`),
    );
    // the form is gone while it runs: only the progress is visible
    assert.equal(
        await js(
            `[...document.querySelectorAll(".sheet-body > .action, ` +
                `.sheet-body > .ctl, .sheet-body > ` +
                `div:first-child")].every(e ` +
                `=> e.offsetParent === null)`,
        ),
        true,
        "the options and the Export button are hidden while exporting",
    );
    await until("busy state", () =>
        js(`document.body.classList.contains("busy")`),
    );
    assert.equal(
        await js(
            `getComputedStyle(document.getElementById("panel")).pointerEvents`,
        ),
        "none",
        "tools are disabled while exporting",
    );
    assert.match(
        await js(`document.getElementById("title").textContent`),
        /exporting/,
    );
    assert.match(
        await js(`document.querySelector(".export-status").textContent`),
        /^Exporting/,
    );
    await shot("m4-3-exporting.png");
    await until(
        "done",
        () => js(`document.querySelector("a.action[download]") !== null`),
        120000,
    );
    const link = await js(
        `(() => { const a = document.querySelector("a.action[download]"); ` +
            `return { href: a.getAttribute("href"), name: a.download, text: ` +
            `a.textContent, done: ` +
            `document.querySelector(".export-done").textContent }; })()`,
    );
    console.log("done:", link.done, "|", link.text);
    assert.match(link.href, /^\/api\/export\/e\d+\/file$/);
    assert.equal(link.name, "ui export.tif");
    const edge = (t) =>
        Math.max(
            ...t
                .match(/(\d+) × (\d+)/)
                .slice(1)
                .map(Number),
        );
    assert.equal(edge(link.done), 1920, "resized to 1920: " + link.done);
    const dl = await js(
        `fetch(${JSON.stringify(link.href)}).then(async r => { const b = new ` +
            `Uint8Array(await r.arrayBuffer()); return { status: r.status, ` +
            `type: r.headers.get("content-type"), size: b.length, magic: ` +
            `String.fromCharCode(b[0], b[1]) }; })`,
    );
    assert.equal(dl.status, 200);
    assert.equal(dl.type, "image/tiff");
    assert.ok(dl.size > 1e6);
    assert.ok(dl.magic === "II" || dl.magic === "MM");
    await until("not busy any more", () =>
        js(`!document.body.classList.contains("busy")`),
    );
    assert.equal(
        await js(
            `document.getElementById("title").textContent.` +
                `includes("exporting")`,
        ),
        false,
    );
    assert.equal(
        await js(
            `getComputedStyle(document.getElementById("panel")).pointerEvents`,
        ),
        "auto",
    );
    assert.equal(
        await js(
            `[...document.querySelectorAll(".sheet-body > .action")].every(e ` +
                `=> e.offsetParent === null)`,
        ),
        true,
        "no Export button next to the download",
    );
    await shot("m4-4-done.png");

    // ---- the choices are remembered; a JPEG with the image's own name -------
    await click(".action", "Export again");
    assert.equal(
        await js(
            `document.querySelector(".sheet-body > .action").offsetParent ` +
                `!== ` +
                `null && ` +
                `document.querySelector(".export-progress").offsetParent === ` +
                `null`,
        ),
        true,
        "back to the form",
    );
    await click(".sheet-close");
    await js(`document.getElementById("export").click()`);
    await until("sheet again", () =>
        js(`document.querySelector(".sheet-title")?.textContent === "Export"`),
    );
    assert.equal(await checked("TIFF"), "true", "the format is remembered");
    assert.equal(await checked("ZIP"), "true");
    assert.equal(await checked("1920 px"), "true", "the size is remembered");
    await click(".chip", "2560 px");
    await click(".chip", "JPEG");
    await js(
        `(() => { const i = document.querySelector(".sheet-body ` +
            `input[type=range]"); i.value = 60; i.dispatchEvent(new ` +
            `Event("input", {bubbles: true})); i.dispatchEvent(new ` +
            `Event("change", {bubbles: true})); })()`,
    );
    await click(".action", "Export");
    await until(
        "jpeg done",
        () => js(`document.querySelector("a.action[download]") !== null`),
        120000,
    );
    const jn = await js(
        `document.querySelector("a.action[download]").download`,
    );
    assert.match(jn, new RegExp(`^${stem}(-\\d+)?\\.jpg$`));
    console.log("jpeg:", jn);
    assert.equal(
        edge(await js(`document.querySelector(".export-done").textContent`)),
        2560,
        "resized to 2560",
    );

    // ---- a failure is shown, with a way back --------------------------------
    await click(".action", "Export again");
    await js(
        `(() => { const i = document.querySelector(".sheet-body ` +
            `input[type=text]"); i.value = "x"; })()`,
    );
    const orig = await js(`window.fetch.toString().length`);
    await js(
        `(() => { const f = window.fetch; window.fetch = (u, o) => String(u) ` +
            `=== "/api/export" ? Promise.resolve(new ` +
            `Response(JSON.stringify({error: "an export is already ` +
            `running"}), {status: 409, headers: {"Content-Type": ` +
            `"application/json"}})) : f(u, o); })()`,
    );
    await click(".action", "Export");
    await until("error shown", () =>
        js(`document.querySelector(".export-progress .error") !== null`),
    );
    assert.match(
        await js(
            `document.querySelector(".export-progress .error").textContent`,
        ),
        /already running/,
    );
    await click(".action", "Back");
    assert.equal(
        await js(
            `document.querySelector(".sheet-body ` +
                `.action:not([hidden])")?.textContent`,
        ),
        "Export",
    );
    void orig;
    console.log("exceptions:", b.logs.length ? b.logs : "none");
    console.log("ui m4: ok");
} finally {
    b.close();
}
