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

// End-to-end test of /api/images, the folder listing of the Open sheet: the images and the subfolders of
// a folder, the folder above (only if it may be browsed too), and the list of the roots. Needs a host with an
// image open (its folder is a root unless the host has --root):
//   node tests/images_e2e.mjs http://localhost:8080
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";
const get = async (dir) => {
    const r = await fetch(`${base}/api/images?dir=${encodeURIComponent(dir)}`);
    return { status: r.status, body: await r.json().catch(() => null) };
};
const st = await (await fetch(base + "/api/status")).json();
assert.ok(st.open, "open an image first");
const file = st.open.file;
const folder = file.slice(0, file.lastIndexOf("/"));

// the folder of the open image
let r = await get(folder);
assert.equal(r.status, 200);
assert.equal(r.body.dir, folder);
assert.ok(r.body.images.some((i) => i.path === file), "the open image is listed");
assert.ok(Array.isArray(r.body.dirs));
for (const d of r.body.dirs) {
    assert.ok(d.name && !d.name.startsWith("."), "no hidden folders: " + d.name);
    assert.equal(d.path, folder + "/" + d.name);
}
assert.equal(typeof r.body.parent, "string");
console.log(`folder: ${r.body.images.length} images, ${r.body.dirs.length} folders, parent "${r.body.parent}"`);

// the list of the roots: folders, no images
const roots = await get("");
assert.equal(roots.status, 200);
assert.equal(roots.body.dir, "");
assert.deepEqual(roots.body.images, []);
assert.ok(roots.body.dirs.length >= 1, "there is a root");
assert.ok(
    roots.body.dirs.some((d) => folder === d.path || folder.startsWith(d.path + "/")),
    "the folder of the open image is under a root",
);

// a root can be listed; what is above a root is not offered
const root = roots.body.dirs[0];
r = await get(root.path);
assert.equal(r.status, 200);
assert.equal(r.body.parent, "", "above a root: the list of the roots");

// refused: outside the roots, no such folder
assert.equal((await get("/etc")).status, 403);
assert.equal((await get(folder + "/no-such-folder")).status, 404);
// a file is not a folder
assert.equal((await get(file)).status, 404);
console.log("images e2e: ok");
