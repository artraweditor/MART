// The app as a PWA: manifest, installability, service worker, and starting with the server away.
// Starts and stops the host itself:   MART_CMD='path/to/mart --www ... photo.arw' node tests/ui_pwa.mjs [outdir]
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const cmdline = process.env.MART_CMD;
assert.ok(cmdline, "set MART_CMD to the command that starts the host on port 8080");
const out = process.argv[2];
const start = () => spawn("sh", ["-c", `exec ${cmdline}`], { stdio: "ignore" });
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { await fetch("http://localhost:8080/api/status"); return; } catch { await sleep(500); } } throw new Error("host did not start"); };
const until = async (what, fn, ms = 30000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(200); } };

let host = start();
const b = await launch({ out, window: "390,844" });
const { js } = b;
try {
    await waitUp();
    await b.goto("http://localhost:8080/");
    await until("loaded", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`));

    // ---- the manifest and what the browser makes of it -----------------------------------------------------------
    const man = await b.cmd("Page.getAppManifest");
    assert.deepEqual(man.errors, [], "the manifest has no errors");
    const m = JSON.parse(man.data);
    assert.equal(m.name, "MART"); assert.equal(m.display, "standalone"); assert.equal(m.start_url, "/");
    assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"));
    assert.ok(m.icons.some((i) => i.purpose === "maskable"));
    for (const i of m.icons) { const r = await fetch("http://localhost:8080/" + i.src); assert.equal(r.status, 200, i.src); assert.equal(r.headers.get("content-type"), "image/png"); }
    assert.equal((await fetch("http://localhost:8080/manifest.webmanifest")).headers.get("content-type"), "application/manifest+json");
    // the icon file is the small PNG, not the large source picture
    assert.equal((await fetch("http://localhost:8080/icons/MART-portrait.svg")).status, 404);
    const inst = await b.cmd("Page.getInstallabilityErrors");
    console.log("installability errors:", inst.installabilityErrors.length ? JSON.stringify(inst.installabilityErrors) : "none");
    assert.deepEqual(inst.installabilityErrors, [], "the browser considers the app installable");
    assert.equal(await js(`document.querySelector('link[rel=apple-touch-icon]').getAttribute("href")`), "icons/apple-touch-icon.png");

    // ---- the service worker ------------------------------------------------------------------------------------------
    await until("service worker active", () => js(`navigator.serviceWorker.getRegistration().then(r => r?.active?.state === "activated")`));
    const keys = await js(`caches.keys()`);
    assert.equal(keys.length, 1); assert.match(keys[0], /^mart-[0-9a-f]{12}$/);
    await until("app cached", () => js(`caches.open(${JSON.stringify(keys[0])}).then(c => c.keys()).then(k => k.length >= 20)`));
    const cached = await js(`caches.open(${JSON.stringify(keys[0])}).then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname))`);
    for (const f of ["/", "/index.html", "/app/main.js", "/styles/base.css", "/manifest.webmanifest", "/icons/icon-192.png"]) assert.ok(cached.includes(f), "cached: " + f);
    // nothing of the server's answers is kept
    await js(`fetch("/api/status").then(r => r.json())`);
    await js(`fetch("/api/info").then(r => r.json())`);
    assert.equal(await js(`caches.keys().then(async ks => { for (const k of ks) for (const r of await (await caches.open(k)).keys()) if (new URL(r.url).pathname.startsWith("/api/")) return true; return false; })`), false, "no /api/ in the cache");
    console.log("cached:", cached.length, "files in", keys[0]);

    // ---- the server goes away: the app still opens, and says so ----------------------------------------------------------
    host.kill("SIGTERM");
    await sleep(1500);
    await b.goto("http://localhost:8080/");
    await until("app from the cache", () => js(`document.getElementById("tabs")?.children.length === 4`), 15000);   // the page and its scripts ran
    await until("clear message", () => js(`!document.getElementById("overlay").hidden`), 15000);
    const msg = await js(`document.getElementById("ov-title").textContent`);
    assert.match(msg, /Cannot reach the MART server/);
    assert.equal(await js(`document.getElementById("conn").className`), "dot bad");
    assert.equal(await js(`navigator.serviceWorker.controller !== null`), true, "the page is served by the service worker");
    if (out) await b.shot("ui-6-offline.png");
    console.log("without the server:", msg);

    // ---- and when it comes back, the app carries on ------------------------------------------------------------------------
    host = start();
    await waitUp();
    await until("reconnected", () => js(`document.getElementById("overlay").hidden && window.__mart?.size().w > 0`), 30000);
    assert.equal(await js(`document.getElementById("conn").className`), "dot ok");
    console.log("exceptions:", b.logs.length ? b.logs : "none");
    console.log("ui pwa: ok");
} finally {
    b.close();
    host.kill("SIGTERM");
}
