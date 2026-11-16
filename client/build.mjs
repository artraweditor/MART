// Build: compile the TypeScript to ES modules in dist/app, the service worker to dist/sw.js, and copy the static files.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

rmSync("dist", { recursive: true, force: true });
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.json"], { stdio: "inherit" });
execFileSync("node_modules/.bin/tsc", ["-p", "sw/tsconfig.json"], { stdio: "inherit" });
mkdirSync("dist/styles", { recursive: true });
cpSync("index.html", "dist/index.html");
cpSync("manifest.webmanifest", "dist/manifest.webmanifest");
cpSync("styles", "dist/styles", { recursive: true });
// the PNG icons only: the source picture is large and not needed at run time
mkdirSync("dist/icons", { recursive: true });
for (const f of readdirSync("icons")) if (f.endsWith(".png")) cpSync(join("icons", f), join("dist/icons", f));

// what the service worker keeps for offline start-up, and a version that changes when any of it does
const files = [];
const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (!e.name.endsWith(".map") && p !== "dist/sw.js") files.push(p);
    }
};
walk("dist");
files.sort();
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(readFileSync(f));
const shell = ["/", ...files.map((f) => "/" + f.slice("dist/".length))];
let sw = readFileSync("dist/sw.js", "utf8");
sw = sw.replace("__VERSION__", hash.digest("hex").slice(0, 12)).replace("__SHELL__", JSON.stringify(shell));
writeFileSync("dist/sw.js", sw);
console.log(`client built in dist/ (${files.length} files kept for offline start-up)`);
