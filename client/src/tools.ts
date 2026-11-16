// The tools of the panel and how their controls map to partial profiles
// (keys and ranges: ART's tools/mcp/reference).

import type { Params, Patch } from "./live.js";

export interface Getter {
    (group: string, key: string): unknown;
}

export interface SliderDef {
    kind: "slider";
    label: string;
    group: string;
    key: string;
    min: number;
    max: number;
    step: number;
    def: number;
    digits: number;
    /** other keys that must go with this one */
    extra?: (get: Getter) => Record<string, unknown>;
}

export interface ChoiceDef {
    kind: "choice";
    label: string;
    group: string;
    key: string;
    options: { value: string; label: string }[];
    def: string;
    extra?: (get: Getter) => Record<string, unknown>;
}

export interface ToggleDef {
    kind: "toggle";
    label: string;
    group: string;
    key: string;
    def: boolean;
}

export type ControlDef = SliderDef | ChoiceDef | ToggleDef;

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

export const TOOLS: Tool[] = [
    {
        id: "light",
        label: "Light",
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
        ],
    },
    {
        id: "tone",
        label: "Tone",
        controls: [
            { kind: "slider", label: "Contrast", group: "ToneCurve", key: "Contrast", min: -100, max: 100, step: 1, def: 0, digits: 0 },
            {
                kind: "choice",
                label: "Base curve",
                group: "ToneCurve",
                key: "BaseCurve",
                def: "Linear",
                options: ["Linear", "Rolloff", "SCurve"].map((v) => ({ value: v, label: v === "SCurve" ? "S-curve" : v })),
            },
            { kind: "toggle", label: "Auto-matched curve", group: "ToneCurve", key: "HistogramMatching", def: false },
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
    const keys: Record<string, unknown> = { Enabled: true };
    if (def.kind !== "toggle" && def.extra) Object.assign(keys, def.extra(get));
    // a white balance preset is a plain Setting, whatever extra says
    keys[def.key] = value;
    return { [def.group]: keys };
}

export function readValue(params: Params, def: ControlDef): unknown {
    const v = params[def.group]?.[def.key];
    return v === undefined ? def.def : v;
}
