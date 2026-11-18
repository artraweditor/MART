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

// The host must exit promptly, and clean up, when asked to stop while a browser
// is connected (an open WebSocket and an
// idle keep-alive connection must not keep it alive):
//   node tests/shutdown_e2e.mjs /path/to/mart --www ... photo.arw      (starts
// the host itself, on port 8080)
import { spawn } from "node:child_process";
const [bin, ...args] = process.argv.slice(2);
const p = spawn(bin, args, { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
    try {
        await fetch("http://localhost:8080/api/status");
        break;
    } catch {
        await sleep(500);
    }
}
const ws = new WebSocket("ws://localhost:8080/api/ws");
let closedAt = null;
ws.onclose = () => {
    closedAt = Date.now();
};
await new Promise((r) => (ws.onopen = r));
// keep-alive connection left open too
await fetch("http://localhost:8080/api/status");
const t0 = Date.now();
const exited = new Promise((r) => p.on("exit", (code) => r(code)));
p.kill("SIGTERM");
const code = await Promise.race([
    exited,
    sleep(20000).then(() => "STILL RUNNING after 20 s"),
]);
console.log(
    "exit:",
    code,
    "after",
    Date.now() - t0,
    "ms; websocket closed after",
    closedAt ? closedAt - t0 + " ms" : "never",
);
if (code !== 0) {
    p.kill("SIGKILL");
    process.exit(1);
}
if (!closedAt) {
    console.error("the WebSocket was not closed");
    process.exit(1);
}
if (Date.now() - t0 > 5000) {
    console.error("too slow to stop");
    process.exit(1);
}
console.log("shutdown e2e: ok");
