// The host must exit promptly, and clean up, when asked to stop while a browser is connected (an open WebSocket and an
// idle keep-alive connection must not keep it alive):
//   node tests/shutdown_e2e.mjs /path/to/mart --www ... photo.arw      (starts the host itself, on port 8080)
import { spawn } from "node:child_process";
const [bin, ...args] = process.argv.slice(2);
const p = spawn(bin, args, { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { await fetch("http://localhost:8080/api/status"); break; } catch { await sleep(500); } }
const ws = new WebSocket("ws://localhost:8080/api/ws");
let closedAt = null;
ws.onclose = () => { closedAt = Date.now(); };
await new Promise((r) => (ws.onopen = r));
await fetch("http://localhost:8080/api/status"); // keep-alive connection left open too
const t0 = Date.now();
const exited = new Promise((r) => p.on("exit", (code) => r(code)));
p.kill("SIGTERM");
const code = await Promise.race([exited, sleep(20000).then(() => "STILL RUNNING after 20 s")]);
console.log("exit:", code, "after", Date.now() - t0, "ms; websocket closed after", closedAt ? closedAt - t0 + " ms" : "never");
if (code !== 0) { p.kill("SIGKILL"); process.exit(1); }
if (!closedAt) { console.error("the WebSocket was not closed"); process.exit(1); }
if (Date.now() - t0 > 5000) { console.error("too slow to stop"); process.exit(1); }
console.log("shutdown e2e: ok");
