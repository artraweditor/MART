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

// The Export sheet: export of the image as it is now (full size, or resized),
// then a download (in the app: the system's "save to" picker).

import {
    ApiError,
    NetworkError,
    exportStatus,
    exportUrl,
    startExport,
} from "./api.js";
import type { ExportOptions, ExportStatus } from "./api.js";
import { isNative, nativeSaveFile } from "./native.js";
import { el, openSheet } from "./sheet.js";

interface Saved {
    format: "jpg" | "png" | "tif";
    quality: number;
    pngBits: 8 | 16;
    tifBits: 8 | 16 | 32;
    compression: "none" | "zip";
    /** the longest edge in pixels at most; 0: full size */
    size: 0 | 1920 | 2560 | 3840;
}

const DEFAULTS: Saved = {
    format: "jpg",
    quality: 92,
    pngBits: 8,
    tifBits: 16,
    compression: "none",
    size: 0,
};
const KEY = "mart.export";

function load(): Saved {
    try {
        return {
            ...DEFAULTS,
            ...JSON.parse(localStorage.getItem(KEY) ?? "{}"),
        };
    } catch {
        return { ...DEFAULTS };
    }
}
function save(s: Saved): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
        /* storage blocked: the choices are just not remembered */
    }
}

/** the request for these choices (and a name, if the user typed one) */
export function toOptions(s: Saved, name: string): ExportOptions {
    const o: ExportOptions = { format: s.format };
    if (s.format === "jpg") o.quality = s.quality;
    if (s.format === "png") o.bits = s.pngBits;
    if (s.format === "tif") {
        o.bits = s.tifBits;
        o.compression = s.compression;
    }
    if (s.size) o.size = s.size;
    if (name.trim()) o.name = name.trim();
    return o;
}

export function formatBytes(n: number): string {
    return n >= 1e6
        ? `${(n / 1e6).toFixed(1)} MB`
        : `${Math.max(1, Math.round(n / 1e3))} kB`;
}

export function formatElapsed(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// an export in progress (the sheet can be closed and reopened)
let activeJob: string | null = null;

export function showExport(imageName: string): void {
    const sheet = openSheet("Export");
    let closed = false;
    const origClose = sheet.close;
    sheet.close = () => {
        closed = true;
        origClose();
    };
    const body = sheet.body;
    const s = load();

    const chips = (
        label: string,
        options: [string, string][],
        current: () => string,
        set: (v: string) => void,
    ): HTMLElement => {
        const group = el(
            "div",
            { class: "ctl" },
            el("div", { class: "row" }, el("label", { text: label })),
        );
        const row = el("div", { class: "chips" });
        const buttons: [string, HTMLButtonElement][] = [];
        const paint = (): void =>
            buttons.forEach(([v, b]) =>
                b.setAttribute("aria-checked", String(v === current())),
            );
        for (const [value, text] of options) {
            const b = el("button", { class: "chip", text });
            b.type = "button";
            b.setAttribute("role", "radio");
            b.addEventListener("click", () => {
                set(value);
                paint();
                save(s);
                renderOptions();
            });
            buttons.push([value, b]);
            row.append(b);
        }
        paint();
        group.append(row);
        return group;
    };

    const options = el("div");
    const name = el("input", { type: "text", placeholder: imageName });
    name.setAttribute("aria-label", "File name");
    name.autocapitalize = "off";
    name.spellcheck = false;
    const go = el("button", { class: "action", text: "Export" });
    const progress = el("div", { class: "export-progress" });
    body.append(
        options,
        el(
            "div",
            { class: "ctl" },
            el("div", { class: "row" }, el("label", { text: "File name" })),
            name,
        ),
        go,
        progress,
    );

    function renderOptions(): void {
        options.replaceChildren(
            chips(
                "Format",
                [
                    ["jpg", "JPEG"],
                    ["png", "PNG"],
                    ["tif", "TIFF"],
                ],
                () => s.format,
                (v) => (s.format = v as Saved["format"]),
            ),
            chips(
                "Size",
                [
                    ["1920", "1920 px"],
                    ["2560", "2560 px"],
                    ["3840", "3840 px"],
                    ["0", "Full size"],
                ],
                () => String(s.size),
                (v) => (s.size = Number(v) as Saved["size"]),
            ),
        );
        if (s.size)
            options.append(
                el("p", {
                    class: "muted",
                    text:
                        `The longest edge is at most ${s.size} px.`,
                }),
            );
        if (s.format === "jpg") {
            const q = el("div", { class: "ctl" });
            const out = el("output", { text: String(s.quality) });
            const input = el("input", { type: "range" });
            input.min = "50";
            input.max = "100";
            input.step = "1";
            input.value = String(s.quality);
            input.setAttribute("aria-label", "JPEG quality");
            input.addEventListener("input", () => {
                s.quality = Number(input.value);
                out.textContent = input.value;
            });
            input.addEventListener("change", () => save(s));
            q.append(
                el(
                    "div",
                    { class: "row" },
                    el("label", { text: "Quality" }),
                    out,
                ),
                input,
            );
            options.append(q);
        } else if (s.format === "png") {
            options.append(
                chips(
                    "Bit depth",
                    [
                        ["8", "8 bit"],
                        ["16", "16 bit"],
                    ],
                    () => String(s.pngBits),
                    (v) => (s.pngBits = Number(v) as 8 | 16),
                ),
            );
        } else {
            options.append(
                chips(
                    "Bit depth",
                    [
                        ["8", "8 bit"],
                        ["16", "16 bit"],
                        ["32", "32 bit float"],
                    ],
                    () => String(s.tifBits),
                    (v) => (s.tifBits = Number(v) as 8 | 16 | 32),
                ),
                chips(
                    "Compression",
                    [
                        ["none", "None"],
                        ["zip", "ZIP"],
                    ],
                    () => s.compression,
                    (v) => (s.compression = v as Saved["compression"]),
                ),
            );
        }
    }
    renderOptions();

    const showForm = (on: boolean): void => {
        options.hidden = !on;
        name.parentElement!.hidden = !on;
        go.hidden = !on;
        progress.hidden = on;
    };

    const watch = async (job: string): Promise<void> => {
        showForm(false);
        activeJob = job;
        const status = el("p", { class: "export-status" });
        progress.replaceChildren(
            el("div", { class: "spinner", title: "" }),
            status,
            el("p", {
                class: "muted",
                text:
                    "Editing is paused until the export is finished: it " +
                    "renders the whole image.",
            }),
        );
        let misses = 0;
        for (;;) {
            let st: ExportStatus;
            try {
                st = await exportStatus(job);
                misses = 0;
            } catch (e) {
                if (e instanceof ApiError) {
                    activeJob = null;
                    finish(
                        `The export is no longer known to the server ` +
                            `(${e.message}).`,
                        null,
                    );
                    return;
                }
                // the network or server is away for a moment: keep asking, say
                // so after a while
                if (e instanceof NetworkError && ++misses > 3)
                    status.textContent = "Waiting for the server…";
                await new Promise((r) => setTimeout(r, 1000));
                if (closed) return;
                continue;
            }
            if (st.state === "done") {
                activeJob = null;
                finish(null, { job, st });
                return;
            }
            if (st.state === "error") {
                activeJob = null;
                finish(st.error ?? "The export failed.", null);
                return;
            }
            status.textContent = `Exporting… ${formatElapsed(st.elapsed_ms)}`;
            await new Promise((r) => setTimeout(r, 500));
            // the export goes on; reopening this sheet picks it up again
            if (closed) return;
        }
    };

    const finish = (
        error: string | null,
        ok: { job: string; st: ExportStatus } | null,
    ): void => {
        progress.replaceChildren();
        if (error || !ok) {
            const again = el("button", { class: "action", text: "Back" });
            again.addEventListener("click", () => showForm(true));
            progress.append(
                el("p", {
                    class: "error",
                    text: error ?? "The export failed.",
                }),
                again,
            );
            return;
        }
        const { job, st } = ok;
        const facts = [
            `${st.width} × ${st.height}`,
            st.bytes ? formatBytes(st.bytes) : "",
            `${formatElapsed(st.elapsed_ms)}`,
        ]
            .filter(Boolean)
            .join(" · ");
        if (isNative() && st.path) {
            // in the app: choose where to save the file (offered at once)
            const path = st.path;
            const note = el("p", { class: "muted" });
            const save = el("button", { class: "action", text: "Save to…" });
            const saveFile = async (): Promise<void> => {
                try {
                    note.textContent = (await nativeSaveFile(path))
                        ? `Saved ${st.name}.`
                        : "Not saved yet.";
                } catch (e) {
                    note.textContent = e instanceof Error ? e.message : String(e);
                }
            };
            save.addEventListener("click", () => void saveFile());
            progress.append(
                el("p", { class: "export-done", text: "Exported: " + facts }),
                save,
                note,
            );
            void saveFile();
            return;
        }
        const a = el("a", { class: "action", text: `Download ${st.name}` });
        a.href = exportUrl(job);
        a.download = st.name ?? "";
        if (st.path)
            progress.append(
                el("p", {
                    class: "muted",
                    text: `Also kept on the server: ${st.path}`,
                }),
            );
        const again = el("button", {
            class: "action secondary",
            text: "Export again",
        });
        again.addEventListener("click", () => showForm(true));
        progress.append(again);
    };

    go.addEventListener("click", async () => {
        go.disabled = true;
        try {
            await watch(await startExport(toOptions(s, name.value)));
        } catch (e) {
            showForm(false);
            finish(e instanceof Error ? e.message : String(e), null);
        } finally {
            go.disabled = false;
        }
    });

    showForm(true);
    if (activeJob) void watch(activeJob);
}
