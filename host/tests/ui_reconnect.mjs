// The UI when the server goes away and comes back. Starts and stops the host itself:
//   MART_CMD='path/to/mart --www ... photo.arw' node tests/ui_reconnect.mjs [outdir]
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { launch, sleep } from "./cdp.mjs";

const cmdline = process.env.MART_CMD;
assert.ok(cmdline, "set MART_CMD to the command that starts the host on port 8080");
const out = process.argv[2];
const start = () => spawn("sh", ["-c", `exec ${cmdline}`], { stdio: "ignore" });
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { await fetch("http://localhost:8080/api/status"); return; } catch { await sleep(500); } } throw new Error("host did not start"); };

let host = start();
const b = await launch({ out });
try {
    await waitUp();
    await b.goto("http://localhost:8080/");
    await sleep(3000);
    assert.equal(await b.js(`document.getElementById("overlay").hidden`), true);
    assert.equal(await b.js(`document.getElementById("conn").className`), "dot ok");

    host.kill("SIGTERM");
    await sleep(3000);
    assert.equal(await b.js(`document.getElementById("overlay").hidden`), false, "overlay shown when the server is gone");
    assert.match(await b.js(`document.getElementById("ov-title").textContent`), /Connection lost/);
    assert.equal(await b.js(`document.getElementById("conn").className`), "dot bad");
    if (out) await b.shot("ui-5-lost.png");

    host = start();
    await waitUp();
    await sleep(9000); // reconnect backoff is at most 5 s, then the image loads again
    assert.equal(await b.js(`document.getElementById("overlay").hidden`), true, "overlay hidden after reconnecting");
    assert.equal(await b.js(`document.getElementById("conn").className`), "dot ok");
    console.log("exceptions:", b.logs.length ? b.logs : "none");
    console.log("ui reconnect: ok");
} finally {
    b.close();
    host.kill("SIGTERM");
}
