// Build: compile the TypeScript to ES modules in dist/app and copy the static files.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.json"], { stdio: "inherit" });
mkdirSync("dist/styles", { recursive: true });
cpSync("index.html", "dist/index.html");
cpSync("styles", "dist/styles", { recursive: true });
console.log("client built in dist/");
