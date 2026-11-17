// The page must never scroll sideways on a phone: every tab and the main sheets fit the width of the screen.
//   node tests/ui_overflow.mjs http://localhost:8080 [outdir]
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: "390,844" });
const { js } = b;
// what sticks out of the screen: the page width itself and any visible element ending beyond it
const wide = (root) => js(`(() => { const W = document.documentElement.clientWidth; return { W, scroll: document.documentElement.scrollWidth, bad: [...document.querySelectorAll(${JSON.stringify(root)} + " *")].filter(e => e.offsetParent !== null && e.getBoundingClientRect().right > W + 1).map(e => e.tagName + "#" + e.id + "." + e.className).slice(0, 5) }; })()`);
try {
    for (const w of [320, 360, 390, 430]) {
        await b.emulate(w, 844, 3);
        await b.goto(base);
        for (let i = 0; i < 100 && !(await js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`)); i++) await sleep(100);
        for (const tab of ["Tone", "Color", "Detail", "Crop", "Other"]) {
            await js(`[...document.querySelectorAll("#tabs button")].find(x => x.textContent === ${JSON.stringify(tab)}).click()`);
            await sleep(300);
            const r = await wide("body");
            assert.deepEqual([r.scroll <= r.W, r.bad], [true, []], `${w}px, ${tab}: ${JSON.stringify(r)}`);
        }
        for (const open of ["look", "more"]) {
            await js(`document.getElementById(${JSON.stringify(open)}).click()`);
            await sleep(600);
            const r = await wide("#sheet");
            assert.deepEqual([r.scroll <= r.W, r.bad], [true, []], `${w}px, sheet ${open}: ${JSON.stringify(r)}`);
            await js(`document.querySelector(".sheet-close").click()`);
            await sleep(150);
        }
        console.log(`${w}px: fits`);
    }
    console.log("ui overflow: ok");
} finally {
    await b.close();
}
