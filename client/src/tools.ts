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

// The tools of the panel and how their controls map to partial profiles
// (keys and ranges: ART's tools/mcp/reference).

import type { Params, Patch } from "./live.js";

export interface Getter {
    (group: string, key: string): unknown;
}

/** show a control only while a key of its group has one of these values */
export interface ShowWhen {
    key: string;
    values: unknown[];
}

interface Base {
    label: string;
    group: string;
    showWhen?: ShowWhen;
}

export interface SliderDef extends Base {
    kind: "slider";
    key: string;
    min: number;
    max: number;
    step: number;
    def: number;
    digits: number;
    /**
     * a logarithmic scale, as ART's Adjuster::setLogScale(base, pivot): the
     * slider's position runs linearly from `min` to `max`, the value grows
     * exponentially away from `pivot`, so that the values near it are finer
     */
    log?: { base: number; pivot: number };
    /** other keys that must go with this one */
    extra?: (get: Getter) => Record<string, unknown>;
    /**
     * the key holds a list and the slider is its element `index`; the list is
     * `scale` times the slider's value
     */
    index?: number;
    scale?: number;
    /** the list when the profile has none */
    list?: number[];
    /**
     * for values that are not a plain key of the group (the parameters of a
     * LUT): where to read it, what to write
     */
    read?: (params: Params) => unknown;
    write?: (value: unknown, get: Getter) => Record<string, unknown>;
}

export interface ChoiceDef extends Base {
    kind: "choice";
    key: string;
    options: { value: string | number; label: string }[];
    def: string | number;
    extra?: (get: Getter) => Record<string, unknown>;
    read?: (params: Params) => unknown;
    write?: (value: unknown, get: Getter) => Record<string, unknown>;
}

export interface ToggleDef extends Base {
    kind: "toggle";
    key: string;
    def: boolean;
    extra?: (get: Getter) => Record<string, unknown>;
    read?: (params: Params) => unknown;
    write?: (value: unknown, get: Getter) => Record<string, unknown>;
}

/** the tone curve editor */
export interface CurveDef extends Base {
    kind: "curve";
    key: string;
    extra?: (get: Getter) => Record<string, unknown>;
}

/** a title between groups of controls */
export interface HeadingDef extends Base {
    kind: "heading";
}

/**
 * a panel built by another module (see `registerControl` in controls.ts): the
 * film simulation, the list of other tools
 */
export interface CustomDef extends Base {
    kind: "custom";
    name: "clut" | "info" | "retouch";
}

export type ControlDef =
    SliderDef | ChoiceDef | ToggleDef | CurveDef | HeadingDef | CustomDef;

export interface Tool {
    id: string;
    label: string;
    controls: ControlDef[];
}

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);

/**
 * the keys to write with a Temperature or Green change: the loader needs both
 */
const customWB = (get: Getter): Record<string, unknown> => ({
    Setting: "CustomTemp",
    Temperature: Math.round(num(get("White Balance", "Temperature"), 6500)),
    Green: num(get("White Balance", "Green"), 1),
});

/**
 * the settings of the noise reduction presets (Detail tab); "off" just disables
 * the tool
 */
export const DENOISE_PRESETS: Record<string, Record<string, unknown>> = {
    low: {
        ColorSpace: "RGB",
        Aggressive: false,
        Gamma: 1.7,
        Luminance: 0,
        LuminanceDetail: 0,
        LuminanceDetailThreshold: 0,
        ChrominanceMethod: 1,
        ChrominanceAutoFactor: 0.5,
        SmoothingEnabled: false,
        GuidedChromaRadius: 3,
        NLStrength: 0,
    },
    medium: {
        ColorSpace: "RGB",
        Aggressive: false,
        Gamma: 1.7,
        Luminance: 15,
        LuminanceDetail: 0,
        LuminanceDetailThreshold: 0,
        ChrominanceMethod: 1,
        ChrominanceAutoFactor: 0.5,
        SmoothingEnabled: true,
        GuidedChromaRadius: 3,
        NLStrength: 0,
    },
    high: {
        ColorSpace: "RGB",
        Aggressive: false,
        Gamma: 1.7,
        Luminance: 30,
        LuminanceDetail: 0,
        LuminanceDetailThreshold: 0,
        ChrominanceMethod: 1,
        ChrominanceAutoFactor: 0.7,
        SmoothingEnabled: true,
        GuidedChromaRadius: 3,
        NLStrength: 0,
    },
};

/**
 * "off", a preset's name, or "custom" for settings that are none of them (they
 * stay as they are until a preset is chosen)
 */
export function denoiseValue(g: Record<string, unknown> | undefined): string {
    if (!g || g["Enabled"] !== true) return "off";
    const same = (a: unknown, b: unknown): boolean =>
        typeof b === "number"
            ? typeof a === "number" && Math.abs(a - b) < 1e-6
            : a === b;
    for (const [name, p] of Object.entries(DENOISE_PRESETS)) {
        if (Object.entries(p).every(([k, v]) => same(g[k], v))) return name;
    }
    return "custom";
}

/**
 * the groups that have no `Enabled` key: LensProfile is on when its mode is not
 * "none"; RAW has a switch for each feature
 */
const NO_ENABLED = new Set(["LensProfile", "RAW"]);

/**
 * The haze removal slider (-100..100) and the strength curve of ART's Dehaze
 * tool, which MART keeps a straight line:
 * its level goes from 0 (adds haze) to 1 (removes it), 0.5 does nothing.
 */
export const hazeLevel = (v: number): number =>
    Math.round((0.5 + v / 200) * 1e4) / 1e4;

/**
 * The slider value for the strength of the profile: its curve
 * (`1;0;a;0;0;1;a;0;0;`, the mean level of its points),
 * or the level `a` itself, which is what a patch holds (and what the client's
 * parameters keep until the engine
 * reports them again).
 */
export function hazeValue(curve: unknown): number {
    if (typeof curve === "number")
        return Number.isFinite(curve) ? Math.round((curve - 0.5) * 200) : 0;
    const n =
        typeof curve === "string"
            ? curve
                  .split(";")
                  .filter((x) => x.trim() !== "")
                  .map(Number)
            : [];
    const ys: number[] = [];
    for (let i = 2; i < n.length; i += 4)
        if (Number.isFinite(n[i])) ys.push(n[i]!);
    if (!ys.length) return 0;
    return Math.round((ys.reduce((a, b) => a + b, 0) / ys.length - 0.5) * 200);
}

/** a profile's list of numbers (`900;100;0;`), or null */
export function parseList(v: unknown): number[] | null {
    if (Array.isArray(v)) return v.map(Number);
    if (typeof v !== "string") return null;
    const l = v
        .split(";")
        .filter((x) => x.trim() !== "")
        .map(Number);
    return l.length && l.every(Number.isFinite) ? l : null;
}

/**
 * the tone curve is always applied in Neutral mode (both curves, as that is
 * what the editor shows)
 */
const neutral = (): Record<string, unknown> => ({
    CurveMode: "Neutral",
    CurveMode2: "Neutral",
});

/**
 * capture sharpening always uses deconvolution with a radius of its own, never
 * the automatic one
 */
const rld = (get: Getter): Record<string, unknown> => ({
    Method: "rld",
    DeconvAutoRadius: false,
    DeconvRadius: num(get("Sharpening", "DeconvRadius"), 0.75),
});

const primarySliders = (
    key: "HueTweak" | "SatTweak",
    what: string,
): ControlDef[] =>
    ["Red", "Green", "Blue"].map((p, i): ControlDef => ({
        kind: "slider",
        label: `${p} ${what}`,
        group: "Channel Mixer",
        key,
        index: i,
        scale: 1,
        list: [0, 0, 0],
        min: -100,
        max: 100,
        step: 1,
        def: 0,
        digits: 0,
        extra: () => ({ Mode: 1 }),
    }));

export const TOOLS: Tool[] = [
    {
        id: "tone",
        label: "Tone",
        controls: [
            { kind: "heading", label: "Exposure and haze", group: "Exposure" },
            {
                kind: "slider",
                label: "Exposure",
                group: "Exposure",
                key: "Compensation",
                min: -4,
                max: 4,
                step: 0.01,
                def: 0,
                digits: 2,
            },
            {
                kind: "slider",
                label: "Black point",
                group: "Exposure",
                key: "Black",
                min: -2,
                max: 2,
                step: 0.01,
                def: 0,
                digits: 2,
            },
            {
                kind: "choice",
                label: "Highlight recovery",
                group: "Exposure",
                key: "HLRecovery",
                def: "Off",
                options: ["Off", "Blend", "Color", "Balanced"].map((v) => ({
                    value: v,
                    label: v,
                })),
            },
            {
                // one slider for the whole Dehaze tool: a straight strength
                // curve, in RGB mode
                kind: "slider",
                label: "Haze removal",
                group: "Dehaze",
                key: "Strength",
                min: -100,
                max: 100,
                step: 1,
                def: 0,
                digits: 0,
                read: (params) =>
                    params["Dehaze"]?.["Enabled"] === true
                        ? hazeValue(params["Dehaze"]?.["Strength"])
                        : 0,
                write: (v) => ({
                    Enabled: Number(v) !== 0,
                    Strength: hazeLevel(Number(v)),
                    Luminance: false,
                }),
            },
            {
                kind: "heading",
                label: "Contrast and curve",
                group: "ToneCurve",
            },
            {
                kind: "slider",
                label: "Contrast",
                group: "ToneCurve",
                key: "Contrast",
                min: -100,
                max: 100,
                step: 1,
                def: 0,
                digits: 0,
                extra: neutral,
            },
            {
                kind: "choice",
                label: "Base curve",
                group: "ToneCurve",
                key: "BaseCurve",
                def: "Linear",
                extra: neutral,
                options: ["Linear", "Rolloff", "SCurve"].map((v) => ({
                    value: v,
                    label: v === "SCurve" ? "S-curve" : v,
                })),
            },
            {
                kind: "toggle",
                label: "Auto-matched curve",
                group: "ToneCurve",
                key: "HistogramMatching",
                def: false,
                extra: neutral,
            },
            {
                kind: "curve",
                label: "Tone curve",
                group: "ToneCurve",
                key: "Curve",
                extra: neutral,
            },
            {
                kind: "heading",
                label: "Tone equalizer",
                group: "ToneEqualizer",
            },
            ...["Blacks", "Shadows", "Midtones", "Highlights", "Whites"].map(
                (label, i): ControlDef => ({
                    kind: "slider",
                    label,
                    group: "ToneEqualizer",
                    key: `Band${i}`,
                    min: -100,
                    max: 100,
                    step: 1,
                    def: 0,
                    digits: 0,
                }),
            ),
            {
                kind: "slider",
                label: "Pivot (EV)",
                group: "ToneEqualizer",
                key: "Pivot",
                min: -4,
                max: 4,
                step: 0.1,
                def: 0,
                digits: 1,
            },
        ],
    },
    {
        id: "color",
        label: "Color",
        controls: [
            { kind: "heading", label: "White balance", group: "White Balance" },
            {
                kind: "slider",
                label: "Temperature",
                group: "White Balance",
                key: "Temperature",
                min: 2000,
                max: 12000,
                step: 10,
                def: 6500,
                digits: 0,
                extra: (get) => {
                    const { Temperature: _t, ...rest } = customWB(get);
                    return rest;
                },
            },
            {
                kind: "slider",
                label: "Tint",
                group: "White Balance",
                key: "Green",
                min: 0.5,
                max: 1.5,
                step: 0.005,
                def: 1,
                digits: 3,
                extra: (get) => {
                    const { Green: _g, ...rest } = customWB(get);
                    return rest;
                },
            },
            {
                kind: "choice",
                label: "White balance",
                group: "White Balance",
                key: "Setting",
                def: "Camera",
                options: [
                    { value: "Camera", label: "As shot" },
                    { value: "Auto", label: "Auto" },
                ],
            },
            { kind: "heading", label: "Saturation", group: "Saturation" },
            {
                kind: "slider",
                label: "Saturation",
                group: "Saturation",
                key: "Saturation",
                min: -100,
                max: 100,
                step: 1,
                def: 0,
                digits: 0,
            },
            {
                kind: "slider",
                label: "Vibrance",
                group: "Saturation",
                key: "Vibrance",
                min: -100,
                max: 100,
                step: 1,
                def: 0,
                digits: 0,
            },
            {
                kind: "heading",
                label: "Primaries correction",
                group: "Channel Mixer",
            },
            ...primarySliders("HueTweak", "hue"),
            ...primarySliders("SatTweak", "saturation"),
            { kind: "heading", label: "Soft light", group: "SoftLight" },
            {
                kind: "toggle",
                label: "Enabled",
                group: "SoftLight",
                key: "Enabled",
                def: false,
            },
            {
                kind: "slider",
                label: "Strength",
                group: "SoftLight",
                key: "Strength",
                min: 0,
                max: 100,
                step: 1,
                def: 30,
                digits: 0,
            },
            {
                kind: "heading",
                label: "Film simulation",
                group: "Film Simulation",
            },
            {
                kind: "custom",
                label: "Film simulation",
                group: "Film Simulation",
                name: "clut",
            },
        ],
    },
    {
        id: "detail",
        label: "Detail",
        controls: [
            { kind: "heading", label: "Lens correction", group: "LensProfile" },
            {
                kind: "choice",
                label: "Source",
                group: "LensProfile",
                key: "LcMode",
                def: "none",
                options: [
                    { value: "none", label: "Off" },
                    { value: "lfauto", label: "Automatic" },
                    { value: "exif", label: "Embedded" },
                ],
            },
            {
                kind: "toggle",
                label: "Distortion",
                group: "LensProfile",
                key: "UseDistortion",
                def: true,
                showWhen: { key: "LcMode", values: ["lfauto", "exif"] },
            },
            {
                kind: "toggle",
                label: "Vignetting",
                group: "LensProfile",
                key: "UseVignette",
                def: true,
                showWhen: { key: "LcMode", values: ["lfauto", "exif"] },
            },
            {
                kind: "toggle",
                label: "Chromatic aberration",
                group: "LensProfile",
                key: "UseCA",
                def: false,
                showWhen: { key: "LcMode", values: ["lfauto", "exif"] },
            },
            {
                // the flat field of the raw file (DNG gain maps, as phones
                // write them); it is used only if the file has one
                kind: "toggle",
                label: "Use the embedded flat field, if any",
                group: "RAW",
                key: "FlatFieldUseEmbedded",
                def: false,
                write: (v) =>
                    v === true
                        ? { FlatFieldUseEmbedded: true, FlatFieldEnabled: true }
                        : { FlatFieldUseEmbedded: false },
            },
            {
                kind: "heading",
                label: "Capture sharpening",
                group: "Sharpening",
            },
            {
                kind: "toggle",
                label: "Enabled",
                group: "Sharpening",
                key: "Enabled",
                def: false,
                extra: rld,
            },
            {
                kind: "slider",
                label: "Radius",
                group: "Sharpening",
                key: "DeconvRadius",
                min: 0.4,
                max: 2.5,
                step: 0.01,
                def: 0.75,
                digits: 2,
                extra: rld,
            },
            {
                kind: "slider",
                label: "Amount",
                group: "Sharpening",
                key: "DeconvAmount",
                min: 0,
                max: 100,
                step: 1,
                def: 100,
                digits: 0,
                extra: rld,
            },
            {
                kind: "slider",
                label: "Contrast threshold",
                group: "Sharpening",
                key: "Contrast",
                min: 0,
                max: 200,
                step: 1,
                def: 20,
                digits: 0,
                extra: rld,
            },
            { kind: "heading", label: "Noise reduction", group: "Denoise" },
            {
                kind: "choice",
                label: "Noise reduction",
                group: "Denoise",
                key: "Enabled",
                def: "off",
                options: ["off", "low", "medium", "high"].map((v) => ({
                    value: v,
                    label: v[0]!.toUpperCase() + v.slice(1),
                })),
                read: (params) => denoiseValue(params["Denoise"]),
                write: (v) =>
                    v === "off"
                        ? { Enabled: false }
                        : { Enabled: true, ...DENOISE_PRESETS[String(v)] },
            },
            // a region of the Local Contrast tool (host/src/localcontrast.cc)
            {
                kind: "heading",
                label: "Local contrast",
                group: "LocalContrast",
            },
            {
                kind: "toggle",
                label: "Enabled",
                group: "LocalContrast",
                key: "Enabled",
                def: false,
            },
            {
                kind: "slider",
                label: "Fine",
                group: "LocalContrast",
                key: "Fine",
                min: -100,
                max: 100,
                step: 1,
                def: 0,
                digits: 0,
            },
            {
                kind: "slider",
                label: "Coarse",
                group: "LocalContrast",
                key: "Coarse",
                min: -100,
                max: 100,
                step: 1,
                def: 0,
                digits: 0,
            },
            { kind: "heading", label: "Film grain", group: "Grain" },
            {
                kind: "toggle",
                label: "Enabled",
                group: "Grain",
                key: "Enabled",
                def: false,
            },
            {
                kind: "slider",
                label: "Strength",
                group: "Grain",
                key: "Strength",
                min: 0,
                max: 100,
                step: 1,
                def: 50,
                digits: 0,
            },
            {
                kind: "slider",
                label: "Coarseness (ISO)",
                group: "Grain",
                key: "ISO",
                min: 100,
                max: 6400,
                step: 50,
                def: 400,
                digits: 0,
            },
            {
                kind: "toggle",
                label: "Color grain",
                group: "Grain",
                key: "Color",
                def: false,
            },
            // not a group of the profile: a region of the Smoothing tool, in
            // halation mode (host/src/halation.cc)
            { kind: "heading", label: "Halation", group: "Halation" },
            {
                kind: "toggle",
                label: "Enabled",
                group: "Halation",
                key: "Enabled",
                def: false,
            },
            {
                kind: "slider",
                label: "Strength",
                group: "Halation",
                key: "Strength",
                min: 0.01,
                max: 5,
                step: 0.01,
                def: 1,
                digits: 2,
            },
            {
                kind: "slider",
                label: "Tint",
                group: "Halation",
                key: "Tint",
                min: -0.5,
                max: 0.5,
                step: 0.001,
                def: 0,
                digits: 3,
            },
        ],
    },
    {
        // regions of ART's color/tone correction tool with a simplified
        // interface (retouch.ts; host/src/retouch.cc)
        id: "retouch",
        label: "Retouch",
        controls: [
            {
                kind: "custom",
                label: "Retouching",
                group: "Retouch",
                name: "retouch",
            },
        ],
    },
    {
        id: "crop",
        label: "Crop",
        // the crop itself is in croptool.ts and the overlay; the fine rotation
        // is a slider
        controls: [
            {
                kind: "slider",
                label: "Straighten",
                group: "Rotation",
                key: "Degree",
                min: -45,
                max: 45,
                step: 0.1,
                def: 0,
                digits: 1,
                // as in ART: fine near 0, where straightening is done
                log: { base: 10, pivot: 0 },
            },
            // ART's vignette filter (post-crop vignette); its center is placed on the picture
            // (crop.ts)
            { kind: "heading", label: "Vignette filter", group: "PCVignette" },
            {
                kind: "toggle",
                label: "Enabled",
                group: "PCVignette",
                key: "Enabled",
                def: false,
            },
            {
                kind: "slider",
                label: "Strength",
                group: "PCVignette",
                key: "Strength",
                min: -6,
                max: 6,
                step: 0.01,
                def: 0.6,
                digits: 2,
            },
            {
                kind: "slider",
                label: "Feather",
                group: "PCVignette",
                key: "Feather",
                min: 0,
                max: 100,
                step: 1,
                def: 50,
                digits: 0,
            },
            {
                kind: "slider",
                label: "Roundness",
                group: "PCVignette",
                key: "Roundness",
                min: 0,
                max: 100,
                step: 1,
                def: 50,
                digits: 0,
            },
        ],
    },
    {
        // the tools of the profile that this app has no controls for:
        // information only (other.ts)
        id: "other",
        label: "Other",
        controls: [
            { kind: "custom", label: "Other tools", group: "", name: "info" },
        ],
    },
];

/** the patch for setting a control to `value` */
export function patchFor(def: ControlDef, value: unknown, get: Getter): Patch {
    if (def.kind === "heading" || def.kind === "custom")
        throw new Error("this control has no value");
    const keys: Record<string, unknown> = NO_ENABLED.has(def.group)
        ? {}
        : { Enabled: true };
    if (def.extra) Object.assign(keys, def.extra(get));
    if (def.kind === "slider" && def.index !== undefined) {
        // one element of a list: the whole list goes
        const list = [
            ...(parseList(get(def.group, def.key)) ?? def.list ?? []),
        ];
        list[def.index] = Math.round(Number(value) * (def.scale ?? 1));
        keys[def.key] = list;
    } else if (def.kind !== "curve" && def.write) {
        Object.assign(keys, def.write(value, get));
    } else {
        // a white balance preset is a plain Setting, whatever extra says
        keys[def.key] = value;
    }
    return { [def.group]: keys };
}

export function readValue(params: Params, def: ControlDef): unknown {
    if (def.kind === "heading" || def.kind === "custom") return undefined;
    if (def.kind !== "curve" && def.read) return def.read(params);
    const v = params[def.group]?.[def.key];
    if (def.kind === "curve") return v;
    if (def.kind === "slider" && def.index !== undefined) {
        const e = (parseList(v) ?? def.list)?.[def.index];
        return e === undefined ? def.def : e / (def.scale ?? 1);
    }
    return v === undefined ? def.def : v;
}

/** is this control shown with these parameters? */
export function isShown(params: Params, def: ControlDef): boolean {
    const w = def.showWhen;
    if (!w) return true;
    const v = params[def.group]?.[w.key];
    const first = TOOLS.flatMap((t) => t.controls).find(
        (c) => c.kind === "choice" && c.group === def.group && c.key === w.key,
    );
    const cur =
        v === undefined && first && first.kind === "choice" ? first.def : v;
    return w.values.includes(cur);
}
