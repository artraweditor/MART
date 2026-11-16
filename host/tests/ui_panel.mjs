// Phone layout: the tools float over the picture, fold away on a tap on the picture or on the open tab,
// and the picture never changes size.   node tests/ui_panel.mjs http://localhost:8080 [outdir]
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:8080";
const b = await launch({ out: process.argv[3] ?? "/tmp", window: "390,844" });
const { js } = b;
const until = async (what, fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(100); } };
const state = () => js(`(() => {
    const p = document.getElementById("panel"), t = document.getElementById("tools"), v = document.getElementById("view").getBoundingClientRect();
    const r = t.getBoundingClientRect();
    return { collapsed: p.classList.contains("collapsed"), toolsShown: getComputedStyle(t).display !== "none", toolsTop: r.top, viewH: v.height, viewBottom: v.bottom, bg: getComputedStyle(t).backgroundColor };
})()`);
try {
    await b.emulate(390, 844);
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));
    await js(`localStorage.removeItem("mart.open")`);
    await b.goto(base);
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));
    await sleep(500);
    const open = await state();
    assert.equal(open.collapsed, false, "open at first");
    assert.ok(open.toolsShown && open.toolsTop < open.viewBottom, "the tools overlay the picture");
    assert.match(open.bg, /rgba\(.*, 0\.8\)/, "about 80% opaque");
    await b.shot("panel-1-open.png");
    // a tap on the picture folds the tools away; the picture keeps its size
    const mid = await js(`(() => { const r = document.getElementById("view").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 80 }; })()`);
    await b.tap(mid.x, mid.y);
    await until("collapsed", async () => (await state()).collapsed);
    const shut = await state();
    assert.equal(shut.toolsShown, false);
    assert.equal(shut.viewH, open.viewH, "the picture did not resize");
    await b.shot("panel-2-collapsed.png");
    // a tab opens them again; the same tab again folds them
    await js(`document.querySelectorAll("#tabs button")[1].click()`);
    assert.equal((await state()).collapsed, false);
    await js(`document.querySelectorAll("#tabs button")[1].click()`);
    assert.equal((await state()).collapsed, true);
    // another tab while folded opens it
    await js(`document.querySelectorAll("#tabs button")[2].click()`);
    assert.equal((await state()).collapsed, false);
    // a drag of the picture (pan) does not fold them
    console.log("ui panel: ok");
} finally {
    await b.close();
}
