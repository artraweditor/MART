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

// The "Other" tab: the tools that the profile applies and that this app has no
// controls for. Information only.

import { registerControl } from "./controls.js";
import type { Control } from "./controls.js";
import type { Params } from "./live.js";
import { el } from "./sheet.js";
import { TOOLS, denoiseValue } from "./tools.js";

/**
 * the groups that are wholly covered by the controls here (or are no tools):
 * never listed. The other groups that have controls are listed for the keys
 * that no control has, when the profile changes them (see `leftovers`)
 */
const COVERED = new Set([
    "Film Simulation",
    "Crop",
    "Rotation",
    "Coarse Transformation",
    "PCVignette",
    "Halation",
    "LocalContrast",
    "Dehaze",
    "Retouch",
]);

/** the keys that the controls of each group edit */
let exposedKeys: Map<string, Set<string>> | null = null;
function exposed(group: string): Set<string> | undefined {
    if (!exposedKeys) {
        exposedKeys = new Map();
        for (const t of TOOLS)
            for (const c of t.controls) {
                if (!("key" in c) || !c.group) continue;
                let s = exposedKeys.get(c.group);
                if (!s) exposedKeys.set(c.group, (s = new Set()));
                s.add(c.key);
            }
    }
    // written together with FlatFieldUseEmbedded
    exposedKeys.get("RAW")?.add("FlatFieldEnabled");
    return exposedKeys.get(group);
}

/**
 * the keys of a group that has controls but not for all of them, that the
 * profile sets to something other than what the neutral profile has
 */
function leftovers(
    group: string,
    g: Record<string, unknown>,
    defaults: Params | undefined,
): [string, string][] {
    const keys = exposed(group)!;
    const d = defaults?.[group];
    if (!d) return [];
    return Object.entries(g)
        .filter(
            ([k, v]) =>
                k !== "Enabled" &&
                !keys.has(k) &&
                JSON.stringify(v) !== JSON.stringify(d[k]),
        )
        .map(([k, v]): [string, string] => [k, show(v)]);
}

const NAMES: Record<string, string> = {
    Exposure: "Exposure",
    "White Balance": "White balance",
    ToneCurve: "Tone curve",
    Saturation: "Saturation and vibrance",
    ToneEqualizer: "Tone equalizer",
    "Channel Mixer": "Primaries correction",
    SoftLight: "Soft light",
    Sharpening: "Capture sharpening",
    Grain: "Film grain",
    LensProfile: "Lens correction",
    "Black & White": "Black & white",
    CACorrection: "Chromatic aberration correction",
    ColorCorrection: "Color/tone correction",
    Defringing: "Defringing",
    Dehaze: "Dehaze",
    Denoise: "Noise reduction",
    Distortion: "Distortion",
    DynamicRangeCompression: "Dynamic range compression",
    "Film Negative": "Film negative",
    Gradient: "Graduated filter",
    "HSL Equalizer": "Color equalizer",
    "Impulse Denoising": "Impulse noise reduction",
    "Local Contrast": "Local contrast",
    LogEncoding: "Log tone mapping",
    "Luminance Curve": "L*a*b* adjustments",
    OutputSharpening: "Output sharpening",
    PCVignette: "Post-crop vignette",
    Perspective: "Perspective",
    Resize: "Resize",
    "RGB Curves": "RGB curves",
    Smoothing: "Smoothing",
    "Spot Removal": "Spot removal",
    TextureBoost: "Texture boost",
    "Vignetting Correction": "Vignetting correction",
};

const SMOOTHING_MODES = [
    "Guided",
    "Gaussian",
    "Glow",
    "Non-local means",
    "Motion blur",
    "Lens blur",
    "Added noise",
    "Halation",
    "Wavelets",
];
const SMOOTHING_CHANNELS = ["luminance", "chrominance", "RGB"];
const SMOOTHING_WITH_CHANNEL = new Set([0, 1, 3, 6, 8]);

/**
 * the name of the Smoothing region that the Detail tab makes (see
 * host/src/halation.cc)
 */
const OURS = "MART halation";
/** likewise, the region of the Local Contrast tool (host/src/localcontrast.cc) */
const OURS_LC = "MART local contrast";

export interface Item {
    name: string;
    /** a few words after the name */
    summary: string;
    rows: [string, string][];
}

const show = (v: unknown): string => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 90 ? s.slice(0, 87) + "…" : s;
};

/** the highest region index among keys `<prefix>_N` */
function lastRegion(g: Record<string, unknown>): number {
    let n = 0;
    for (const k of Object.keys(g)) {
        const m = /_(\d+)$/.exec(k);
        if (m) n = Math.max(n, Number(m[1]));
    }
    return n;
}

function smoothing(g: Record<string, unknown>): Item | null {
    const rows: [string, string][] = [];
    for (let k = 1; k <= lastRegion(g); k++) {
        // the halation of the Detail tab
        if (g[`MaskName_${k}`] === OURS) continue;
        const mode = Number(g[`Mode_${k}`] ?? 0);
        let t = SMOOTHING_MODES[mode] ?? `mode ${mode}`;
        if (SMOOTHING_WITH_CHANNEL.has(mode)) {
            const channel = Number(g[`Channel_${k}`] ?? 2);
            t += `, ${SMOOTHING_CHANNELS[channel] ?? ""}`;
        }
        if (g[`MaskEnabled_${k}`] === false) t += " (off)";
        rows.push([`Region ${k}`, t]);
    }
    return rows.length
        ? {
              name: NAMES["Smoothing"]!,
              summary: `${rows.length} region${rows.length > 1 ? "s" : ""}`,
              rows,
          }
        : null;
}

/**
 * the prefix of the name of the regions of the Retouch tab (see
 * host/src/retouch.cc)
 */
const RETOUCH = "MART retouch ";

function colorCorrection(g: Record<string, unknown>): Item | null {
    const rows: [string, string][] = [];
    for (let k = 1; k <= lastRegion(g); k++) {
        // the Retouch tab's own
        if (String(g[`MaskName_${k}`] ?? "").startsWith(RETOUCH)) continue;

        let t = String(g[`Mode_${k}`] ?? "Jzazbz");
        if (g[`MaskEnabled_${k}`] === false) t += " (off)";
        rows.push([`Region ${k}`, t]);
    }
    return rows.length
        ? {
              name: NAMES["ColorCorrection"]!,
              summary: `${rows.length} region${rows.length === 1 ? "" : "s"}`,
              rows,
          }
        : null;
}

/** the tools that the profile applies and that have no controls in this app */
export function summarize(params: Params): Item[] {
    const items: Item[] = [];
    // what the neutral profile has, from the host
    const defaults = params["Defaults"] as unknown as Params | undefined;
    for (const [group, g] of Object.entries(params)) {
        if (group === "Defaults" || COVERED.has(group) || !g) continue;
        if (exposed(group) && group !== "Denoise") {
            // a tool with controls: only what they do not edit
            if (g["Enabled"] === false) continue;
            const rows = leftovers(group, g, defaults);
            if (rows.length)
                items.push({
                    name: NAMES[group] ?? group,
                    summary: "other settings",
                    rows,
                });
            continue;
        }
        if (g["Enabled"] !== true) continue;
        // one of the presets of the Detail tab
        if (group === "Denoise" && denoiseValue(g) !== "custom") continue;
        if (group === "Smoothing") {
            const s = smoothing(g);
            if (s) items.push(s);
        } else if (group === "ColorCorrection") {
            const c = colorCorrection(g);
            if (c) items.push(c);
        } else if (group === "Local Contrast" || group === "TextureBoost") {
            let n = lastRegion(g) + 1; // the first region has no suffix
            if (group === "Local Contrast") {
                // the one of the Detail tab
                for (let k = 0; k < lastRegion(g) + 1; k++)
                    if (g[k ? `MaskName_${k}` : "MaskName"] === OURS_LC) n--;
                if (n <= 0) continue;
            }
            items.push({
                name: NAMES[group]!,
                summary: `${n} region${n > 1 ? "s" : ""}`,
                rows: [],
            });
        } else {
            const rows = Object.entries(g)
                .filter(([k]) => k !== "Enabled")
                .map(([k, v]): [string, string] => [k, show(v)]);
            items.push({ name: NAMES[group] ?? group, summary: "", rows });
        }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

registerControl("info", (): Control => {
    const root = el("div", { class: "other" });
    root.append(
        el("p", {
            class: "muted",
            text:
                "Tools that the profile applies and that this app cannot " +
                "edit. They are kept when you save.",
        }),
    );
    const list = el("div");
    root.append(list);
    let shown = "";
    return {
        el: root,
        sync(params) {
            const items = summarize(params);
            const json = JSON.stringify(items);
            // keep the open items open while the user edits something else
            if (json === shown) return;
            shown = json;
            list.replaceChildren();
            if (!items.length) {
                list.append(
                    el("p", {
                        class: "muted",
                        text:
                            "None: every tool of this profile has controls " +
                            "here.",
                    }),
                );
                return;
            }
            for (const it of items) {
                const d = el("details", { class: "other-item" });
                const s = el("summary", {}, it.name);
                if (it.summary)
                    s.append(
                        el("span", { class: "muted", text: "  " + it.summary }),
                    );
                d.append(s);
                if (it.rows.length) {
                    const dl = el("dl", { class: "facts tags" });
                    for (const [k, v] of it.rows)
                        dl.append(el("dt", { text: k }), el("dd", { text: v }));
                    d.append(dl);
                }
                list.append(d);
            }
        },
    };
});
