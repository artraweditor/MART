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

// Drives the web UI in headless Chrome through the DevTools protocol:
//   node tests/ui_smoke.mjs [http://localhost:8080] [outdir]
// Needs a running host with an image open, and Chrome (CHROME=... to override).
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const out = process.argv[3] ?? tmpdir();
const b = await launch({ out });
const { js, shot } = b;
try {
    await b.goto(base);
    await sleep(3000);
    assert.equal(
        await js(`document.getElementById("overlay").hidden`),
        true,
        "overlay should be hidden once connected",
    );
    assert.equal(
        await js(`document.getElementById("conn").className`),
        "dot ok",
    );
    await shot("ui-1-loaded.png");

    const setSlider = (label, v) =>
        js(
            `(() => { const l=[...document.querySelectorAll(".ctl ` +
                `label")].find(x=>x.textContent==="${label}"); const ` +
                `i=l.closest(".ctl").querySelector("input"); i.value=${v}; ` +
                `i.dispatchEvent(new Event("input",{bubbles:true})); ` +
                `i.dispatchEvent(new Event("change",{bubbles:true})); return ` +
                `i.value; })()`,
        );
    assert.equal(await setSlider("Exposure", 1.5), "1.5");
    await sleep(2500);
    assert.equal(
        await js(`document.getElementById("save").disabled`),
        false,
        "save enabled after an edit",
    );
    assert.equal(
        await js(`document.getElementById("undo").disabled`),
        false,
        "undo enabled after an edit",
    );
    await shot("ui-2-exposure.png");

    // a drag: many input events, one change at the end
    await js(
        `(async () => { const l=[...document.querySelectorAll(".ctl ` +
            `label")].find(x=>x.textContent==="Exposure"); const ` +
            `i=l.closest(".ctl").querySelector("input"); for (let ` +
            `k=0;k<40;k++){ i.value=1.5-k*0.05; i.dispatchEvent(new ` +
            `Event("input",{bubbles:true})); await new ` +
            `Promise(r=>setTimeout(r,16)); } i.dispatchEvent(new ` +
            `Event("change",{bubbles:true})); })()`,
    );
    await sleep(2500);
    await js(`document.getElementById("undo").click()`);
    await sleep(2500);
    const exp = await js(
        `(() => { const l=[...document.querySelectorAll(".ctl ` +
            `label")].find(x=>x.textContent==="Exposure"); return ` +
            `l.closest(".ctl").querySelector("input").value; })()`,
    );
    assert.equal(
        exp,
        "1.5",
        "undo reverts the whole drag, back to the first edit",
    );
    await shot("ui-3-undo.png");

    // second tab, a preset chip
    await js(
        `[...document.querySelectorAll("#tabs ` +
            `button")].find(b=>b.textContent==="Color").click()`,
    );
    await sleep(300);
    await setSlider("Saturation", 60);
    await sleep(2500);
    await shot("ui-4-color.png");
    console.log("exceptions:", b.logs.length ? b.logs : "none");
    console.log("ui smoke: ok");
} finally {
    b.close();
}
