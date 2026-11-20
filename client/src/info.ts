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

// The Info sheet: a summary of the image, and all its metadata (read-only).

import { getMetadata } from "./api.js";
import type { ImageInfo, Metadata } from "./api.js";
import { el, openSheet } from "./sheet.js";

const MAX_ROWS = 300;

export function formatShutter(s: number): string {
    return s >= 1 ? `${+s.toFixed(1)} s` : `1/${Math.round(1 / s)} s`;
}

/** [label, value] rows of the basic information; missing values are left out */
export function summaryRows(i: ImageInfo): [string, string][] {
    const rows: [string, string][] = [];
    const add = (k: string, v: string | null) => v && rows.push([k, v]);
    add("File", i.file.split("/").pop() ?? i.file);
    add("Camera", [i.make, i.model].filter(Boolean).join(" ") || null);
    add("Lens", i.lens || null);
    add(
        "Size",
        `${i.full_width} × ${i.full_height}` +
            (i.is_raw ? "" : " (not a raw file)"),
    );
    if (i.source_width !== i.full_width || i.source_height !== i.full_height)
        add("Sensor size", `${i.source_width} × ${i.source_height}`);
    add("ISO", i.iso != null ? String(i.iso) : null);
    add("Aperture", i.f_number != null ? `f/${+i.f_number.toFixed(1)}` : null);
    add(
        "Shutter",
        i.shutter_s != null && i.shutter_s > 0
            ? formatShutter(i.shutter_s)
            : null,
    );
    add(
        "Focal length",
        i.focal_length_mm != null
            ? `${+i.focal_length_mm.toFixed(1)} mm`
            : null,
    );
    add(
        "Exposure comp.",
        i.exposure_compensation != null
            ? `${i.exposure_compensation > 0 ? "+" : ""}` +
                  `${+i.exposure_compensation.toFixed(2)} EV`
            : null,
    );
    add("Orientation", i.orientation || null);
    return rows;
}

export function tagValue(v: Metadata[string]): string {
    if (Array.isArray(v)) return v.join(", ");
    return v === null ? "–" : String(v);
}

/**
 * The tags whose name or value contains every word of `filter`, sorted by name
 */
export function filterTags(md: Metadata, filter: string): [string, string][] {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const out: [string, string][] = [];
    for (const k of Object.keys(md).sort()) {
        const v = tagValue(md[k]!);
        const hay = (k + " " + v).toLowerCase();
        if (words.every((w) => hay.includes(w))) out.push([k, v]);
    }
    return out;
}

export function showInfo(info: ImageInfo): void {
    const sheet = openSheet("Image information");
    const tabs = el("div", { class: "subtabs", type: "" });
    const summaryTab = el("button", { class: "chip", text: "Summary" });
    const metaTab = el("button", { class: "chip", text: "All metadata" });
    tabs.append(summaryTab, metaTab);
    const content = el("div", { class: "sheet-content" });
    sheet.body.append(tabs, content);

    const select = (which: "summary" | "meta"): void => {
        summaryTab.setAttribute("aria-checked", String(which === "summary"));
        metaTab.setAttribute("aria-checked", String(which === "meta"));
        content.replaceChildren();
        if (which === "summary") renderSummary();
        else void renderMetadata();
    };

    const renderSummary = (): void => {
        const dl = el("dl", { class: "facts" });
        for (const [k, v] of summaryRows(info))
            dl.append(el("dt", { text: k }), el("dd", { text: v }));
        content.append(dl);
    };

    const renderMetadata = async (): Promise<void> => {
        let md: Metadata = {};
        const filter = el("input", {
            type: "search",
            placeholder: "Filter, e.g. lens or gps",
        });
        filter.setAttribute("aria-label", "Filter the tags");
        const status = el("p", { class: "muted" });
        const list = el("dl", { class: "facts tags" });
        content.append(filter, status, list);

        const render = (): void => {
            const rows = filterTags(md, filter.value);
            list.replaceChildren();
            for (const [k, v] of rows.slice(0, MAX_ROWS))
                list.append(el("dt", { text: k }), el("dd", { text: v }));
            status.textContent =
                rows.length > MAX_ROWS
                    ? `${rows.length} tags; showing the first ${MAX_ROWS}: ` +
                      `refine the filter`
                    : `${rows.length} of ${Object.keys(md).length} tags`;
        };
        const load = async (): Promise<void> => {
            status.textContent = "Reading…";
            try {
                md = await getMetadata(false, false);
                render();
            } catch (e) {
                status.textContent = e instanceof Error ? e.message : String(e);
            }
        };
        let timer = 0;
        filter.addEventListener("input", () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(render, 120);
        });
        const flip = (b: HTMLElement, on: boolean): void =>
            b.setAttribute("aria-checked", String(on));
        await load();
    };

    summaryTab.addEventListener("click", () => select("summary"));
    metaTab.addEventListener("click", () => select("meta"));
    select("summary");
}
