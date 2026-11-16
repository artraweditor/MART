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
    /** other keys that must go with this one */
    extra?: (get: Getter) => Record<string, unknown>;
    /** the key holds a list and the slider is its element `index`; the list is `scale` times the slider's value */
    index?: number;
    scale?: number;
    /** the list when the profile has none */
    list?: number[];
}

export interface ChoiceDef extends Base {
    kind: "choice";
    key: string;
    options: { value: string | number; label: string }[];
    def: string | number;
    extra?: (get: Getter) => Record<string, unknown>;
}

export interface ToggleDef extends Base {
    kind: "toggle";
    key: string;
    def: boolean;
    extra?: (get: Getter) => Record<string, unknown>;
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

export type ControlDef = SliderDef | ChoiceDef | ToggleDef | CurveDef | HeadingDef;

export interface Tool {
    id: string;
    label: string;
    controls: ControlDef[];
}

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);

/** the keys to write with a Temperature or Green change: the loader needs both */
const customWB = (get: Getter): Record<string, unknown> => ({
    Setting: "CustomTemp",
    Temperature: Math.round(num(get("White Balance", "Temperature"), 6500)),
    Green: num(get("White Balance", "Green"), 1),
});

/** the groups that have no `Enabled` key: they are on when their mode is not "none" */
const NO_ENABLED = new Set(["LensProfile"]);

/** a profile's list of numbers (`900;100;0;`), or null */
export function parseList(v: unknown): number[] | null {
    if (Array.isArray(v)) return v.map(Number);
    if (typeof v !== "string") return null;
    const l = v.split(";").filter((x) => x.trim() !== "").map(Number);
    return l.length && l.every(Number.isFinite) ? l : null;
}

/** the tone curve is always applied in Neutral mode (both curves, as that is what the editor shows) */
const neutral = (): Record<string, unknown> => ({ CurveMode: "Neutral", CurveMode2: "Neutral" });

/** capture sharpening always uses deconvolution with a radius of its own, never the automatic one */
const rld = (get: Getter): Record<string, unknown> => ({
    Method: "rld",
    DeconvAutoRadius: false,
    DeconvRadius: num(get("Sharpening", "DeconvRadius"), 0.75),
});

const primarySliders = (key: "HueTweak" | "SatTweak", what: string): ControlDef[] =>
    ["Red", "Green", "Blue"].map(
        (p, i): ControlDef => ({
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
        }),
    );

export const TOOLS: Tool[] = [
    {
        id: "tone",
        label: "Tone",
        controls: [
            { kind: "slider", label: "Exposure", group: "Exposure", key: "Compensation", min: -4, max: 4, step: 0.01, def: 0, digits: 2 },
            { kind: "slider", label: "Black point", group: "Exposure", key: "Black", min: -2, max: 2, step: 0.01, def: 0, digits: 2 },
            {
                kind: "choice",
                label: "Highlight recovery",
                group: "Exposure",
                key: "HLRecovery",
                def: "Off",
                options: ["Off", "Blend", "Color", "Balanced"].map((v) => ({ value: v, label: v })),
            },
            { kind: "heading", label: "Contrast and curve", group: "ToneCurve" },
            { kind: "slider", label: "Contrast", group: "ToneCurve", key: "Contrast", min: -100, max: 100, step: 1, def: 0, digits: 0, extra: neutral },
            {
                kind: "choice",
                label: "Base curve",
                group: "ToneCurve",
                key: "BaseCurve",
                def: "Linear",
                extra: neutral,
                options: ["Linear", "Rolloff", "SCurve"].map((v) => ({ value: v, label: v === "SCurve" ? "S-curve" : v })),
            },
            { kind: "toggle", label: "Auto-matched curve", group: "ToneCurve", key: "HistogramMatching", def: false, extra: neutral },
            { kind: "curve", label: "Tone curve", group: "ToneCurve", key: "Curve", extra: neutral },
            { kind: "heading", label: "Tone equalizer", group: "ToneEqualizer" },
            ...["Blacks", "Shadows", "Midtones", "Highlights", "Whites"].map(
                (label, i): ControlDef => ({ kind: "slider", label, group: "ToneEqualizer", key: `Band${i}`, min: -100, max: 100, step: 1, def: 0, digits: 0 }),
            ),
            { kind: "slider", label: "Regularization", group: "ToneEqualizer", key: "Regularization", min: 0, max: 4, step: 1, def: 4, digits: 0 },
            { kind: "slider", label: "Pivot (EV)", group: "ToneEqualizer", key: "Pivot", min: -4, max: 4, step: 0.1, def: 0, digits: 1 },
        ],
    },
    {
        id: "color",
        label: "Color",
        controls: [
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
            { kind: "slider", label: "Saturation", group: "Saturation", key: "Saturation", min: -100, max: 100, step: 1, def: 0, digits: 0 },
            { kind: "slider", label: "Vibrance", group: "Saturation", key: "Vibrance", min: -100, max: 100, step: 1, def: 0, digits: 0 },
            { kind: "heading", label: "Channel mixer (primaries)", group: "Channel Mixer" },
            ...primarySliders("HueTweak", "hue"),
            ...primarySliders("SatTweak", "saturation"),
            { kind: "heading", label: "Soft light", group: "SoftLight" },
            { kind: "toggle", label: "Enabled", group: "SoftLight", key: "Enabled", def: false },
            { kind: "slider", label: "Strength", group: "SoftLight", key: "Strength", min: 0, max: 100, step: 1, def: 30, digits: 0 },
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
            { kind: "toggle", label: "Distortion", group: "LensProfile", key: "UseDistortion", def: true, showWhen: { key: "LcMode", values: ["lfauto", "exif"] } },
            { kind: "toggle", label: "Vignetting", group: "LensProfile", key: "UseVignette", def: true, showWhen: { key: "LcMode", values: ["lfauto", "exif"] } },
            { kind: "toggle", label: "Chromatic aberration", group: "LensProfile", key: "UseCA", def: false, showWhen: { key: "LcMode", values: ["lfauto", "exif"] } },
            { kind: "heading", label: "Capture sharpening", group: "Sharpening" },
            { kind: "toggle", label: "Enabled", group: "Sharpening", key: "Enabled", def: false, extra: rld },
            { kind: "slider", label: "Radius", group: "Sharpening", key: "DeconvRadius", min: 0.4, max: 2.5, step: 0.01, def: 0.75, digits: 2, extra: rld },
            { kind: "slider", label: "Amount", group: "Sharpening", key: "DeconvAmount", min: 0, max: 100, step: 1, def: 100, digits: 0, extra: rld },
            { kind: "slider", label: "Contrast threshold", group: "Sharpening", key: "Contrast", min: 0, max: 200, step: 1, def: 20, digits: 0, extra: rld },
        ],
    },
    {
        id: "crop",
        label: "Crop",
        // the crop itself is in croptool.ts and the overlay; the fine rotation is a slider
        controls: [
            { kind: "slider", label: "Straighten", group: "Rotation", key: "Degree", min: -45, max: 45, step: 0.1, def: 0, digits: 1 },
        ],
    },
];

/** the patch for setting a control to `value` */
export function patchFor(def: ControlDef, value: unknown, get: Getter): Patch {
    if (def.kind === "heading") throw new Error("a heading has no value");
    const keys: Record<string, unknown> = NO_ENABLED.has(def.group) ? {} : { Enabled: true };
    if (def.extra) Object.assign(keys, def.extra(get));
    if (def.kind === "slider" && def.index !== undefined) {
        // one element of a list: the whole list goes
        const list = [...(parseList(get(def.group, def.key)) ?? def.list ?? [])];
        list[def.index] = Math.round(Number(value) * (def.scale ?? 1));
        keys[def.key] = list;
    } else {
        // a white balance preset is a plain Setting, whatever extra says
        keys[def.key] = value;
    }
    return { [def.group]: keys };
}

export function readValue(params: Params, def: ControlDef): unknown {
    if (def.kind === "heading") return undefined;
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
    const first = TOOLS.flatMap((t) => t.controls).find((c) => c.kind === "choice" && c.group === def.group && c.key === w.key);
    const cur = v === undefined && first && first.kind === "choice" ? first.def : v;
    return w.values.includes(cur);
}
