// Saving profiles by section, applying them (the halation is added to the image's own smoothing regions), and the
// default profile for images without a sidecar. Needs a host started with --profiles DIR on a COPY of an image:
//   node tests/profiles_e2e.mjs http://localhost:8080 /path/to/copy/photo.arw DIR
import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8080";
const image = realpathSync(process.argv[3] ?? "");
const dir = process.argv[4];
assert.ok(dir, "the folder of the host's profiles");
const bare = join(dirname(image), "no-sidecar.arw");   // the same picture, without a sidecar
const clean = () => { for (const f of [bare, bare + ".arp"]) if (existsSync(f)) unlinkSync(f); };

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
const state = async () => { const s = send({ type: "sync" }); return next((m) => m.type === "state" && m.seq === s); };   // after everything sent before
const edit = async (patch) => { send({ type: "edit", patch }); return state(); };
const apply = async (id) => { send({ type: "profile", id }); return state(); };
const open = async (path) => { const r = await fetch(base + "/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, discard: true }) }); assert.equal(r.status, 200, await r.text()); };
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const regions = (sm) => Object.keys(sm).filter((k) => /^Mode_\d+$/.test(k)).length;

try {
    // ---- the sections --------------------------------------------------------------------------------------------
    const sections = await (await fetch(base + "/api/profile-sections")).json();
    const ids = sections.map((s) => s.id);
    for (const id of ["exposure", "haze", "tone", "toneeq", "wb", "saturation", "mixer", "softlight", "film", "lens", "sharpening", "grain", "halation", "geometry"]) assert.ok(ids.includes(id), id);
    assert.equal(sections.find((s) => s.id === "wb").default, false, "white balance is of the image");
    assert.equal(sections.find((s) => s.id === "exposure").default, true);

    // ---- saving ----------------------------------------------------------------------------------------------------
    await open(image);
    const before = (await state()).params;
    assert.equal(before.Exposure.Compensation, 4.35, "the sidecar of the test image");
    const n0 = regions(before.Smoothing);
    await edit({ Exposure: { Enabled: true, Compensation: 0.5 } });
    await edit({ ToneCurve: { Enabled: true, Contrast: 20 } });
    await edit({ Grain: { Enabled: true, ISO: 1600, Strength: 30 } });
    await edit({ Halation: { Enabled: true, Strength: 2, Tint: -0.1 } });
    await edit({ "White Balance": { Setting: "CustomTemp", Temperature: 4000, Green: 1 } });
    await edit({ RAW: { FlatFieldEnabled: true, FlatFieldUseEmbedded: true } });
    await edit({ Saturation: { Enabled: true, Saturation: 33 } });

    let r = await post("/api/profiles/save", { name: "Test A", sections: ["exposure", "tone", "grain", "halation", "lens"] });
    assert.equal(r.status, 201, await r.clone().text());
    const entry = await r.json();
    assert.deepEqual([entry.name, entry.source, entry.default], ["Test A", "mine", false]);
    const text = readFileSync(join(dir, "Test A.arp"), "utf8");
    for (const must of ["[Exposure]", "Compensation=0.5", "[ToneCurve]", "Contrast=20", "[Grain]", "ISO=1600", "[LensProfile]", "[RAW]", "FlatFieldUseEmbedded=true", "[Smoothing]", "Mode_1=7", "MaskName_1=MART halation", "HalationSize_1=2"])
        assert.ok(text.includes(must), "the profile has " + must);
    for (const mustNot of ["[White Balance]", "[Saturation]", "[Crop]", "[Sharpening]", "CAEnabled", "DarkFrame", "NLStrength", "Mode_2"])
        assert.ok(!text.includes(mustNot), "the profile has no " + mustNot);
    assert.ok(!existsSync(join(dir, "Test A.arp.tmp")));

    // the name is taken: refused, then replaced
    r = await post("/api/profiles/save", { name: "Test A", sections: ["exposure"] });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /already exists/);
    assert.ok(readFileSync(join(dir, "Test A.arp"), "utf8").includes("[Grain]"), "not replaced");
    r = await post("/api/profiles/save", { name: "Test A", sections: ["exposure", "tone", "grain", "halation", "lens"], overwrite: true });
    assert.equal(r.status, 201);
    for (const [body, re] of [[{ name: "", sections: ["exposure"] }, /name/], [{ name: "x", sections: [] }, /nothing/], [{ name: "x", sections: ["nope"] }, /unknown section/], [{ name: "x" }, /expected/], [{ name: "...", sections: ["exposure"] }, /name/]]) {
        r = await post("/api/profiles/save", body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match((await r.json()).error, re);
    }
    r = await post("/api/profiles/save", { name: "../escape", sections: ["exposure"] });
    assert.equal(r.status, 201);
    assert.ok(existsSync(join(dir, "_escape.arp")), "the name cannot leave the folder");
    console.log("saving by section: ok");

    // ---- applying -----------------------------------------------------------------------------------------------------
    await open(image);   // the sidecar again, with its own smoothing region
    let st = await state();
    assert.equal(st.history.can_undo, false);
    const listed = await (await fetch(base + "/api/profiles")).json();
    const a = listed.find((p) => p.name === "Test A");
    assert.ok(a);
    st = await apply(a.id);
    assert.equal(st.params.Exposure.Compensation, 0.5);
    assert.equal(st.params.ToneCurve.Contrast, 20);
    assert.deepEqual([st.params.Grain.Enabled, st.params.Grain.ISO], [true, 1600]);
    assert.deepEqual(st.params.Halation, { Enabled: true, Strength: 2, Tint: -0.1 });
    assert.equal(st.params.Saturation.Saturation, before.Saturation.Saturation, "what the profile does not hold is left");
    assert.equal(regions(st.params.Smoothing), n0 + 1, "the halation is added to the regions of the image");
    for (const [k, v] of Object.entries(before.Smoothing)) if (/_\d+$/.test(k) && Number(k.match(/_(\d+)$/)[1]) <= n0) assert.deepEqual(st.params.Smoothing[k], v, "the image's region is as it was: " + k);
    // the whole profile is one step of the history
    assert.equal(st.history.can_undo, true);
    send({ type: "undo" });
    st = await state();
    assert.equal(st.params.Exposure.Compensation, 4.35, "one undo takes all of it away");
    assert.equal(st.params.Halation.Enabled, false);
    assert.equal(st.history.can_undo, false);
    // appending (the local tools of the image are kept) works too
    send({ type: "profile", id: a.id, append: true });
    st = await state();
    assert.equal(st.params.Halation.Strength, 2);
    console.log("applying: ok");

    // ---- the default profile ------------------------------------------------------------------------------------------
    for (const bad of [":neutral", "u1", "d0:nope.arp", "d0:../x.arp"]) {
        r = await post("/api/profiles/default", { id: bad });
        assert.equal(r.status, 400, bad);
    }
    r = await post("/api/profiles/default", { id: a.id });
    assert.equal(r.status, 200);
    const after = await r.json();
    assert.deepEqual(after.filter((p) => p.default).map((p) => p.name), ["Test A"], "one default");
    assert.equal((await (await fetch(base + "/api/profiles")).json()).find((p) => p.name === "Test A").default, true);

    // a picture without a sidecar gets it, as where the history starts; one with a sidecar does not
    copyFileSync(image, bare);
    await open(bare);
    st = await state();
    assert.equal(st.params.Exposure.Compensation, 0.5, "applied to a picture without a sidecar");
    assert.equal(st.params.Halation.Enabled, true);
    assert.equal(st.params.Halation.Strength, 2);
    assert.equal(st.history.can_undo, false, "it is where the history starts");
    assert.equal((await (await fetch(base + "/api/status")).json()).dirty, false, "and not an edit");
    send({ type: "undo" });
    assert.equal((await state()).params.Exposure.Compensation, 0.5, "it cannot be undone");
    await open(image);
    assert.equal((await state()).params.Exposure.Compensation, 4.35, "not applied to a picture with a sidecar");
    // a sidecar made by saving: the next time the picture is opened it is the sidecar's
    await open(bare);
    await edit({ Exposure: { Enabled: true, Compensation: 1.25 } });
    assert.equal((await fetch(base + "/api/save", { method: "POST" })).status, 200);
    await open(bare);
    assert.equal((await state()).params.Exposure.Compensation, 1.25);
    clean();

    // renaming keeps the default; the picture still gets it
    const warmId = (await (await fetch(base + "/api/profiles")).json()).find((p) => p.name === "Test A").id;
    r = await post("/api/profiles/rename", { id: warmId, name: "Test B" });
    assert.equal(r.status, 200, await r.clone().text());
    const renamed = await r.json();
    assert.deepEqual([renamed.id, renamed.name, renamed.default], ["d0:Test B.arp", "Test B", true]);
    assert.ok(existsSync(join(dir, "Test B.arp")) && !existsSync(join(dir, "Test A.arp")));
    let names = (await (await fetch(base + "/api/profiles")).json()).map((p) => p.name);
    assert.ok(names.includes("Test B") && !names.includes("Test A"));
    copyFileSync(image, bare);
    await open(bare);
    assert.equal((await state()).params.Exposure.Compensation, 0.5, "the default followed the rename");
    clean();
    // what cannot be renamed
    for (const [body, status, re] of [[{ id: renamed.id, name: "_escape" }, 409, /already exists/], [{ id: "d0:nope.arp", name: "x" }, 404, /no such/], [{ id: renamed.id, name: "..." }, 400, /name/],
        [{ id: ":neutral", name: "x" }, 400, /folder/], [{ id: "u1", name: "x" }, 400, /folder/], [{ id: "d0:../x.arp", name: "x" }, 404, /no such/], [{ name: "x" }, 400, /expected/]]) {
        r = await post("/api/profiles/rename", body);
        assert.equal(r.status, status, JSON.stringify(body));
        assert.match((await r.json()).error, re);
    }
    assert.ok(existsSync(join(dir, "Test B.arp")), "nothing happened to it");

    // deleting: the profile goes, and the default with it
    for (const id of [":neutral", "u1"]) assert.equal((await post("/api/profiles/delete", { id })).status, 400, id);
    assert.equal((await post("/api/profiles/delete", { id: "d0:nope.arp" })).status, 404);
    assert.equal((await post("/api/profiles/delete", {})).status, 400);
    r = await post("/api/profiles/delete", { id: renamed.id });
    assert.equal(r.status, 200);
    names = (await r.json()).map((p) => p.name);
    assert.ok(!names.includes("Test B") && names.includes("_escape"));
    assert.ok(!existsSync(join(dir, "Test B.arp")));
    assert.equal((await post("/api/profiles/delete", { id: renamed.id })).status, 404, "already gone");
    assert.deepEqual((await (await fetch(base + "/api/profiles")).json()).filter((p) => p.default), [], "no default any more");
    copyFileSync(image, bare);
    await open(bare);
    st = await state();
    assert.notEqual(st.params.Exposure.Compensation, 0.5, "no default: nothing applied");

    // a picture without a sidecar starts from the neutral profile, not from ART's own default
    const fresh = st.params;
    send({ type: "profile", id: ":neutral" });
    const neutral = (await state()).params;
    for (const g of Object.keys(neutral)) {
        if (g === "Denoise") continue;   // its automatic values are estimated as the picture is rendered
        assert.deepEqual(fresh[g], neutral[g], "as the neutral profile: " + g);
    }
    assert.equal((await state()).history.can_undo, true, "(the neutral profile just applied is an edit; the start was not)");
    await open(image);
    assert.equal((await state()).params.Exposure.Compensation, 4.35, "a picture with a sidecar is as it is");
    console.log("default profile: ok");
    console.log("profiles e2e: ok");
} finally {
    clean();
    await open(image).catch(() => {});
    await post("/api/profiles/default", { id: null }).catch(() => {});
    ws.close();
}
