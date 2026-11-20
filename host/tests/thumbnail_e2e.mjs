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

// End-to-end test of /api/thumbnail (the file selector's thumbnails, made by libART's
// `thumbnail --no-profile`): size, caching header, refused requests. Needs a host with
// an image under one of its roots (the open image is used, or the path given):
//   node tests/thumbnail_e2e.mjs http://localhost:8080 [IMAGE]
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";
let image = process.argv[3];
if (!image) {
    const st = await (await fetch(base + "/api/status")).json();
    assert.ok(st.open, "open an image first, or pass its path");
    image = st.open.file;
}

const get = async (size, path = image) => {
    const q = new URLSearchParams({ path });
    if (size !== undefined) q.set("size", String(size));
    const r = await fetch(`${base}/api/thumbnail?${q}`);
    return { r, buf: Buffer.from(await r.arrayBuffer()) };
};
const jpegSize = (b) => {
    assert.equal(b[0], 0xff);
    assert.equal(b[1], 0xd8);
    for (let i = 2; i < b.length; ) {
        assert.equal(b[i], 0xff);
        const m = b[i + 1],
            len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
            return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + len;
    }
    throw new Error("no SOF");
};

// the default size, and an explicit one
for (const size of [undefined, 256, 128]) {
    const { r, buf } = await get(size);
    assert.equal(r.status, 200, `size ${size}: ${buf.toString().slice(0, 200)}`);
    assert.equal(r.headers.get("content-type"), "image/jpeg");
    assert.match(r.headers.get("cache-control"), /max-age=\d+/);
    const { w, h } = jpegSize(buf);
    const want = size ?? 256;
    assert.ok(Math.max(w, h) <= want, `${w}x${h} exceeds ${want}`);
    // never enlarged, but the longest edge is the size if the source is bigger
    assert.ok(Math.max(w, h) >= Math.min(want, 100), `${w}x${h} is too small`);
    console.log(`thumbnail ${size ?? "(default)"}: ${w}x${h}, ${buf.length} bytes`);
}

// refused: no path, a path outside the roots, no such file, bad sizes
let r = await fetch(`${base}/api/thumbnail`);
assert.equal(r.status, 400);
assert.equal((await get(256, "/etc/hosts")).r.status, 403);
assert.equal((await get(256, image + ".missing")).r.status, 404);
assert.equal((await get(5)).r.status, 400);
assert.equal((await get(100000)).r.status, 400);

// it does not touch the open image
const st = await (await fetch(base + "/api/status")).json();
assert.equal(st.dirty, false);
console.log("thumbnail e2e: ok");
