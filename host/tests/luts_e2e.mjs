// MART's folder of LUTs: import, rename, delete; a profile that holds a LUT of the folder is saved with the host R
// (`file://R/<path in the folder>`, as ART writes its own) and applied by resolving it in the folder.
//   node tests/luts_e2e.mjs http://localhost:8080 LUTS_DIR PROFILES_DIR      (a host started with --luts LUTS_DIR --profiles PROFILES_DIR)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8080";
const lutsDir = process.argv[3], profilesDir = process.argv[4];
assert.ok(lutsDir && profilesDir, "the folders of LUTs and of profiles of the host");

const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws");
ws.binaryType = "arraybuffer";
const inbox = [];
let waiter = null;
ws.onmessage = (ev) => { if (typeof ev.data === "string") { inbox.push(JSON.parse(ev.data)); waiter?.(); } };
const next = (pred, ms = 30000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout; inbox: " + JSON.stringify(inbox.map((m) => [m.type, m.seq, m.message])))), ms);
    const check = () => { const i = inbox.findIndex(pred); if (i >= 0) { clearTimeout(t); waiter = null; resolve(inbox.splice(i, 1)[0]); } else waiter = check; };
    check();
});
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const view = { x: 0, y: 0, w: 0, h: 0, out_w: 200 };
const send = (o) => { const s = ++seq; ws.send(JSON.stringify({ ...o, seq: s, view })); return s; };
const state = async () => { const s = send({ type: "sync" }); return next((m) => m.type === "state" && m.seq === s); };
const edit = async (patch) => { send({ type: "edit", patch }); return state(); };
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const lutList = async () => (await fetch(base + "/api/luts")).json();
const ctl = (gain) => `// @ART-param: ["gain", "Gain", -1.0, 1.0, ${gain}, 0.1]
void ART_main(varying float r, varying float g, varying float b, output varying float rout, output varying float gout, output varying float bout, float gain)
{ rout = r * (1 + gain); gout = g; bout = b; }
`;
const importLut = (name, text = ctl(0.5)) => fetch(base + "/api/luts?name=" + encodeURIComponent(name), { method: "POST", body: text });
const decoded = (v) => decodeURIComponent(v);

try {
    // ---- the folder -----------------------------------------------------------------------------------------------------
    assert.deepEqual((await lutList()).filter((l) => l.name !== "sigmoid.ctl"), [], "nothing of ART's: only what the host's folder has");
    let r = await importLut("grade.ctl");
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { id: "d0:grade.ctl", name: "grade.ctl", source: "mine" });
    assert.ok(existsSync(join(lutsDir, "grade.ctl")));
    assert.equal((await importLut("grade.ctl")).status, 409, "the name is taken");
    assert.equal((await importLut("evil.exe", "MZ")).status, 400);
    assert.equal((await importLut("empty.ctl", "")).status, 400);
    r = await post("/api/luts/rename", { id: "d0:grade.ctl", name: "my film" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id: "d0:my film.ctl", name: "my film.ctl", source: "mine" }, "the extension stays");
    assert.ok(existsSync(join(lutsDir, "my film.ctl")) && !existsSync(join(lutsDir, "grade.ctl")));
    await importLut("other.ctl");
    assert.equal((await post("/api/luts/rename", { id: "d0:other.ctl", name: "my film" })).status, 409);
    assert.equal((await post("/api/luts/rename", { id: "d0:nope.ctl", name: "x" })).status, 404);
    assert.equal((await post("/api/luts/rename", { id: "d0:other.ctl", name: "..." })).status, 400);
    assert.equal((await post("/api/luts/rename", { id: "d0:../x.ctl", name: "x" })).status, 404);
    assert.equal((await post("/api/luts/rename", { name: "x" })).status, 400);
    r = await post("/api/luts/delete", { id: "d0:other.ctl" });
    assert.equal(r.status, 200);
    assert.ok(!(await r.json()).some((l) => l.name === "other.ctl"));
    assert.ok(!existsSync(join(lutsDir, "other.ctl")));
    assert.equal((await post("/api/luts/delete", { id: "d0:other.ctl" })).status, 404);
    assert.equal((await post("/api/luts/delete", { id: "d0:../x" })).status, 404);
    console.log("import, rename, delete: ok");

    // ---- saving a profile: the LUT of the folder is file://R/... ------------------------------------------------------------
    mkdirSync(join(lutsDir, "sub"), { recursive: true });
    writeFileSync(join(lutsDir, "sub", "deep (1).ctl"), ctl(0.2));
    assert.ok((await lutList()).some((l) => l.name === "sub/deep (1).ctl"), "a subfolder is listed");

    let st = await edit({ "Film Simulation": { Enabled: true, ClutFilename: "d0:my film.ctl", ClutParams: { gain: [0.7] }, Strength: 80 } });
    assert.ok(decoded(st.params["Film Simulation"].ClutFilename).endsWith("/my film.ctl"));
    assert.ok(!st.params["Film Simulation"].ClutFilename.startsWith("file://R"), "the engine says where it is: an absolute path (or ~)");
    r = await post("/api/profiles/save", { name: "Film A", sections: ["film"] });
    assert.equal(r.status, 201, await r.clone().text());
    let text = readFileSync(join(profilesDir, "Film A.arp"), "utf8");
    assert.ok(text.includes("ClutFilename=file://R/my%20film.ctl\n"), "the host R, escaped like ART: " + text);
    assert.ok(!text.includes(lutsDir), "no absolute folder in the profile");
    assert.ok(text.includes("Strength=80") && /ClutParams=gain=0\.7/.test(text), text);

    st = await edit({ "Film Simulation": { Enabled: true, ClutFilename: "d0:sub/deep (1).ctl", ClutParams: {} } });
    await post("/api/profiles/save", { name: "Film B", sections: ["film"] });
    text = readFileSync(join(profilesDir, "Film B.arp"), "utf8");
    assert.ok(text.includes("ClutFilename=file://R/sub/deep%20(1).ctl\n"), "a subfolder, with the escapes of GLib: " + text);

    // a LUT that is not in the folder is left as the engine says it
    const elsewhere = join(profilesDir, "..", "elsewhere.ctl");
    writeFileSync(elsewhere, ctl(0.1));
    // (the engine cannot be given a path by the client: write it in a profile, which is how a foreign path gets in)
    writeFileSync(join(profilesDir, "Foreign.arp"), `[Film Simulation]\nEnabled=true\nClutFilename=${elsewhere}\nStrength=100\n`);
    const foreign = (await (await fetch(base + "/api/profiles")).json()).find((p) => p.name === "Foreign");
    send({ type: "profile", id: foreign.id });
    st = await state();
    assert.ok(decoded(st.params["Film Simulation"].ClutFilename).endsWith("/elsewhere.ctl"));
    await post("/api/profiles/save", { name: "Film C", sections: ["film"] });
    text = readFileSync(join(profilesDir, "Film C.arp"), "utf8");
    assert.ok(!text.includes("file://R") && text.includes("elsewhere.ctl"), "not in the folder: as it is: " + text);
    console.log("saving with the R host: ok");

    // ---- applying: the R host is resolved in MART's folder ----------------------------------------------------------------------
    st = await edit({ "Film Simulation": { Enabled: false, ClutFilename: "", ClutParams: {} } });
    assert.equal(st.params["Film Simulation"].ClutFilename, "");
    const profiles = await (await fetch(base + "/api/profiles")).json();
    const idOf = (n) => profiles.find((p) => p.name === n).id;
    send({ type: "profile", id: idOf("Film A") });
    st = await state();
    assert.equal(st.params["Film Simulation"].Enabled, true);
    assert.ok(decoded(st.params["Film Simulation"].ClutFilename).endsWith("/my film.ctl"), st.params["Film Simulation"].ClutFilename);
    assert.equal(st.params["Film Simulation"].Strength, 80);
    // the engine found the file: the parameters of the script are there, with the value of the profile
    const info = await (await fetch(base + "/api/lut/params")).json();
    assert.deepEqual(info.params.map((p) => p.name), ["gain"], "the script was found: " + JSON.stringify(info));
    assert.match(st.params["Film Simulation"].ClutParams, /gain=0\.7/, "its parameter, from the profile");
    // the subfolder one too
    send({ type: "profile", id: idOf("Film B") });
    st = await state();
    assert.ok(decoded(st.params["Film Simulation"].ClutFilename).endsWith("/sub/deep (1).ctl"));
    assert.ok(Number((await (await fetch(base + "/api/lut/params")).json()).params[0].default[0]) === 0.2);
    // the whole profile is one step; applied again, nothing breaks
    send({ type: "undo" });
    st = await state();
    assert.ok(decoded(st.params["Film Simulation"].ClutFilename).endsWith("/my film.ctl"), "undo went back to the first profile");

    // a hand-written profile: a relative path means a path in the folder; one with the R host too
    for (const [name, value] of [["Rel", "my film.ctl"], ["RHand", "file://R/my%20film.ctl"]]) {
        writeFileSync(join(profilesDir, name + ".arp"), `[Film Simulation]\nEnabled=true\nClutFilename=${value}\nStrength=100\n`);
        const e = (await (await fetch(base + "/api/profiles")).json()).find((p) => p.name === name);
        await edit({ "Film Simulation": { ClutFilename: "d0:sub/deep (1).ctl" } });
        send({ type: "profile", id: e.id });
        st = await state();
        assert.ok(decoded(st.params["Film Simulation"].ClutFilename).endsWith("/my film.ctl"), name + ": " + st.params["Film Simulation"].ClutFilename);
    }
    // a profile that refers to a LUT that is not there is applied all the same (as ART does): the film simulation finds nothing
    writeFileSync(join(profilesDir, "Missing.arp"), "[Film Simulation]\nEnabled=true\nClutFilename=file://R/missing.ctl\nStrength=50\n\n[Saturation]\nEnabled=true\nSaturation=21\n");
    const missing = (await (await fetch(base + "/api/profiles")).json()).find((p) => p.name === "Missing");
    send({ type: "profile", id: missing.id });
    st = await state();
    assert.equal(st.params.Saturation.Saturation, 21, "the rest of the profile was applied");
    console.log("applying with the R host: ok");
    console.log("luts e2e: ok");
} finally {
    for (const l of ["my film.ctl", "sub/deep (1).ctl"]) await post("/api/luts/delete", { id: "d0:" + l }).catch(() => {});
    for (const p of ["Film A", "Film B", "Film C", "Foreign", "Rel", "RHand", "Missing"]) await post("/api/profiles/delete", { id: "d0:" + p + ".arp" }).catch(() => {});
    ws.close();
}
