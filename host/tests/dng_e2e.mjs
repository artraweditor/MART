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

// The embedded flat field is on by default for a DNG, unless its sidecar says
// otherwise, and that is not an edit.
// Needs a host started on a COPY of an image (it makes other files next to it,
// and removes them again):
//   node tests/dng_e2e.mjs http://localhost:8080 /path/to/copy/photo.arw
import assert from "node:assert/strict";
import {
    copyFileSync,
    existsSync,
    realpathSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname as dir, join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8080";
const image = realpathSync(process.argv[3] ?? "");
// the same raw data, with the name of a DNG
const dng = join(dir(image), "phone-test.dng");
const clean = () => {
    for (const f of [dng, dng + ".arp"]) if (existsSync(f)) unlinkSync(f);
};
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
        inbox.push(JSON.parse(ev.data));
        waiter?.();
    }
};
const next = (pred, ms = 30000) =>
    new Promise((resolve, reject) => {
        const t = setTimeout(
            () =>
                reject(
                    new Error(
                        "timeout; inbox: " +
                            JSON.stringify(
                                inbox.map((m) => [m.type, m.seq, m.message]),
                            ),
                    ),
                ),
            ms,
        );
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
let seq = 0;
const view = { x: 0, y: 0, w: 0, h: 0, out_w: 200 };
const open = async (path) => {
    const r = await fetch(base + "/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, discard: true }),
    });
    assert.equal(r.status, 200, await r.text());
};
const state = async () => {
    const s = ++seq;
    ws.send(JSON.stringify({ type: "sync", seq: s, view }));
    return next((m) => m.type === "state" && m.seq === s);
};
const status = async () => (await fetch(base + "/api/status")).json();

try {
    copyFileSync(image, dng);
    // no sidecar: on
    await open(dng);
    let st = await state();
    assert.deepEqual(
        [st.params.RAW.FlatFieldEnabled, st.params.RAW.FlatFieldUseEmbedded],
        [true, true],
        "on by default for a DNG",
    );
    assert.equal(st.history.can_undo, false, "it is where the history starts");
    assert.equal((await status()).dirty, false, "and nothing to save");
    let s = ++seq;
    ws.send(JSON.stringify({ type: "undo", seq: s, view }));
    await next((m) => m.type === "state" && m.seq === s);
    st = await state();
    assert.equal(
        st.params.RAW.FlatFieldUseEmbedded,
        true,
        "undo at the start does nothing",
    );
    // the user turns it off, and saves: the choice is kept the next time
    s = ++seq;
    ws.send(
        JSON.stringify({
            type: "edit",
            seq: s,
            view,
            patch: { RAW: { FlatFieldUseEmbedded: false } },
        }),
    );
    // operations are done in order: this state comes after the edit
    st = await state();
    assert.equal(st.history.can_undo, true);
    assert.equal(
        (await fetch(base + "/api/save", { method: "POST" })).status,
        200,
    );
    await open(dng);
    st = await state();
    assert.equal(
        st.params.RAW.FlatFieldUseEmbedded,
        false,
        "a saved choice is respected",
    );
    assert.equal(st.history.can_undo, false);
    clean();

    // the sidecar says off explicitly
    copyFileSync(image, dng);
    writeFileSync(dng + ".arp", "[RAW]\nFlatFieldUseEmbedded=false\n");
    await open(dng);
    st = await state();
    assert.equal(st.params.RAW.FlatFieldUseEmbedded, false);
    clean();

    // a raw that is not a DNG: left alone
    await open(image);
    st = await state();
    assert.notEqual(
        st.params.RAW.FlatFieldUseEmbedded,
        true,
        "not for other raws",
    );
    assert.equal(st.history.can_undo, false);
    console.log("dng e2e: ok");
} finally {
    clean();
    await open(image).catch(() => {});
    ws.close();
}
