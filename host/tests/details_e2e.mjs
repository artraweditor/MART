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

// The details of a retouching region: a region of Local Contrast with a
// linked mask, against the real engine.
//   tests/details_e2e.mjs http://localhost:8080   (fresh host)
import assert from "node:assert/strict";


const base = process.argv[2] ?? "http://localhost:8080";
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => {
    let m;
    if (typeof ev.data === "string") m = JSON.parse(ev.data);
    else {
        const dv = new DataView(ev.data),
            n = dv.getUint32(0);
        m = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data, 4, n)));
        m.frame = true;
    }
    inbox.push(m);
    waiter?.();
};
const next = (pred, ms = 30000) =>
    new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), ms);
        const check = () => {
            const i = inbox.findIndex(pred);
            if (i >= 0) {
                clearTimeout(t);
                waiter = null;
                resolve(inbox.splice(i, 1)[0]);
            } else waiter = check;
        };
        check();
    });
await new Promise((r) => (ws.onopen = r));
let seq = 100;
const view = { x: 0, y: 0, w: 0, h: 0, out_w: 400 };
const send = (o) => {
    const s = ++seq;
    ws.send(JSON.stringify({ ...o, seq: s, view }));
    return s;
};
const params = async () =>
    (await (await fetch(base + "/api/params")).json()).params;
const edit = async (patch) => {
    const s = send({ type: "edit", patch });
    await next((m) => m.frame && m.seq === s);
    return params();
};
const refused = async (patch) => {
    const s = send({ type: "edit", patch });
    const m = await next((x) => x.type === "error" && x.seq === s);
    return m.message;
};

const ini = async () =>
    (await (await fetch(base + "/api/params")).json()).ini;
const lines = (t) => t.split("\n");

let p = await edit({
    Retouch: { 1: { Enabled: true, Slope: 1.2, Details: 50 } },
});
assert.equal(p.Retouch["1"].Details, 50);
assert.equal(p.Retouch["1"].Enabled, true);
let t = await ini();
assert.ok(lines(t).includes("MaskName_1=MART retouch detail 1") ||
    lines(t).includes("MaskName=MART retouch detail 1"), t);
assert.ok(t.includes("LinkedMask") && t.includes("colorcorrection|MART retouch 1"));
assert.ok(/\[Local Contrast\]\nEnabled=true/.test(t));
// the Local contrast tool's own region is unaffected
assert.equal(p.LocalContrast.Enabled, false);

// another value, then the region off: the details go off with it
p = await edit({ Retouch: { 1: { Details: -30 } } });
assert.equal(p.Retouch["1"].Details, -30);
p = await edit({ Retouch: { 1: { Enabled: false } } });
assert.equal(p.Retouch["1"].Details, -30);
t = await ini();
assert.ok(/\[Local Contrast\]\nEnabled=false/.test(t), t);
p = await edit({ Retouch: { 1: { Enabled: true } } });
assert.ok(/\[Local Contrast\]\nEnabled=true/.test(await ini()));

// zero removes them; a value out of range is refused
p = await edit({ Retouch: { 1: { Details: 0 } } });
assert.equal(p.Retouch["1"].Details, 0);
assert.ok(!(await ini()).includes("retouch detail"));
assert.match(await refused({ Retouch: { 1: { Details: 500 } } }), /range/i);

// removing the region removes its details
p = await edit({ Retouch: { 1: { Details: 20 } } });
assert.ok((await ini()).includes("retouch detail 1"));
p = await edit({ Retouch: { 1: null } });
assert.ok(!(await ini()).includes("retouch detail"));

console.log("details e2e: ok");
ws.close();
