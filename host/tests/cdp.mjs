// Minimal headless-Chrome driver over the DevTools protocol (no dependencies).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ window = process.env.WINDOW ?? "1180,820", out = tmpdir(), port = 9333 } = {}) {
    const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "mart-chrome-"))}`,
        `--window-size=${window}`, "--disable-gpu", "--no-first-run", ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []), "about:blank"], { stdio: "ignore" });
    let target;
    for (let i = 0; i < 50 && !target; i++) {
        try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(200); }
    }
    if (!target) { proc.kill(); throw new Error("Chrome did not start"); }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    const logs = [];
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) pending.get(m.id)(m);
        else if (m.method === "Runtime.exceptionThrown") logs.push(JSON.stringify(m.params).slice(0, 300));
    };
    const cmd = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await cmd("Runtime.enable"); await cmd("Page.enable");
    return {
        logs,
        /** any DevTools protocol command */
        cmd: async (method, params = {}) => (await cmd(method, params)).result,
        goto: (url) => cmd("Page.navigate", { url }),
        /** choose files in a file input (as the file dialog would): the first element that matches the selector */
        async setFiles(selector, files) {
            const doc = (await cmd("DOM.getDocument")).result.root.nodeId;
            const node = (await cmd("DOM.querySelector", { nodeId: doc, selector })).result.nodeId;
            if (!node) throw new Error("no " + selector);
            await cmd("DOM.setFileInputFiles", { nodeId: node, files });
        },
        async js(expr) {
            const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
            return r.result.result.value;
        },
        /** a screen of `w` x `h` CSS pixels at `dpr` device pixels per CSS pixel (can be called again to resize) */
        emulate: (w, h, dpr = 1) => cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false }),
        /** a mouse event at page coordinates (the browser turns it into pointer events) */
        mouse: (type, x, y) => cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }),
        async drag(x0, y0, x1, y1, steps = 8) {
            await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 });
            await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", buttons: 1, clickCount: 1 });
            for (let i = 1; i <= steps; i++)
                await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: "left", buttons: 1 });
            await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", buttons: 0, clickCount: 1 });
        },
        async tap(x, y) {
            await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
            await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
            await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
        },
        async shot(name) {
            const r = await cmd("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(out, name), Buffer.from(r.result.data, "base64"));
            console.log("screenshot", join(out, name));
        },
        close() { ws.close(); proc.kill(); },
    };
}
