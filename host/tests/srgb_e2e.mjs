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

// Exports are always sRGB, whatever the output profile of the image says, and
// the image is not touched by it.
// Needs a host started on a COPY of an image (it rewrites the copy's sidecar
// and puts it back):
//   node tests/srgb_e2e.mjs http://localhost:8080 /path/to/copy/photo.arw
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
    existsSync,
    readFileSync,
    realpathSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";

const base = process.argv[2] ?? "http://localhost:8080";
const image = realpathSync(process.argv[3] ?? "");
const sidecar = image + ".arp";
const original = existsSync(sidecar) ? readFileSync(sidecar, "utf8") : null;

const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    inbox.push(JSON.parse(ev.data));
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
const params = async () =>
    (await (await fetch(base + "/api/params")).json()).params;
const status = async () => (await fetch(base + "/api/status")).json();
const exportFile = async (body) => {
    const r = await fetch(base + "/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    assert.equal(r.status, 202, text);
    const { job } = JSON.parse(text);
    let st;
    for (let i = 0; i < 900; i++) {
        st = await (await fetch(base + "/api/export/" + job)).json();
        if (st.state === "done" || st.state === "error") break;
        await new Promise((x) => setTimeout(x, 200));
    }
    assert.equal(st.state, "done", JSON.stringify(st));
    return Buffer.from(
        await (await fetch(base + `/api/export/${job}/file`)).arrayBuffer(),
    );
};
// the embedded ICC profile of a PNG (iCCP chunk: a name, a NUL, the compression
// method, the zlib stream), as text
const iccText = (png) => {
    const at = png.indexOf("iCCP");
    if (at < 0) return null;
    const len = png.readUInt32BE(at - 4);
    const data = png.subarray(at + 4, at + 4 + len);
    const nul = data.indexOf(0);
    return inflateSync(data.subarray(nul + 2)).toString("latin1");
};

try {
    // an image whose output profile is wide gamut (and that has not been
    // edited)
    const wide =
        "[Color " +
        "Management]\nOutputProfile=RTv4_DisplayP3\nOutputProfileIntent=Per" +
        "cep" +
        "tual\nOutputBPC=false\n";
    writeFileSync(
        sidecar,
        (original ?? "").replace(/\n\[Color Management\][^\[]*/, "\n") +
            "\n" +
            wide,
    );
    assert.equal(
        (
            await fetch(base + "/api/open", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: image, discard: true }),
            })
        ).status,
        200,
    );
    ws.send(
        JSON.stringify({
            type: "sync",
            seq: 1,
            view: { x: 0, y: 0, w: 0, h: 0, out_w: 200 },
        }),
    );
    const before = await next((m) => m.type === "state");
    const dirtyBefore = (await status()).dirty;
    assert.equal(
        before.params["Color Management"].OutputProfile,
        "RTv4_DisplayP3",
    );

    const png = await exportFile({
        format: "png",
        size: 300,
        name: "srgb check",
    });
    const icc = iccText(png);
    assert.ok(icc, "the PNG has an embedded profile");
    assert.ok(icc.includes("sRGB"), "it is sRGB");
    assert.ok(!/P3/i.test(icc), "not the image's Display P3");

    // the image itself is as it was: parameters, history and dirty flag
    const p = (await params())["Color Management"];
    assert.deepEqual(
        [p.OutputProfile, p.OutputProfileIntent, p.OutputBPC],
        ["RTv4_DisplayP3", "Perceptual", false],
        "the override is for the export only",
    );
    ws.send(
        JSON.stringify({
            type: "sync",
            seq: 2,
            view: { x: 0, y: 0, w: 0, h: 0, out_w: 200 },
        }),
    );
    const after = await next((m) => m.type === "state" && m.seq === 2);
    assert.deepEqual(after.history, before.history, "the history is unchanged");
    assert.equal((await status()).dirty, dirtyBefore, "and the dirty flag too");
    console.log("export is sRGB, the image is untouched: ok");

    // a TIFF and a JPEG as well (the JPEG carries the profile in an APP2
    // segment)
    const jpg = await exportFile({
        format: "jpg",
        size: 300,
        name: "srgb check 2",
    });
    const at = jpg.indexOf("ICC_PROFILE\0");
    assert.ok(
        at > 0 && jpg.includes("sRGB"),
        "the JPEG carries an sRGB profile",
    );
    assert.ok(!jpg.includes("Display P3"), "not the image's");
    console.log("srgb e2e: ok");
} finally {
    if (original === null) {
        try {
            unlinkSync(sidecar);
        } catch {}
    } else writeFileSync(sidecar, original);
    await fetch(base + "/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: image, discard: true }),
    }).catch(() => {});
    ws.close();
}
