// Film simulation: the parameters of a LUT script as controls, and how they are kept in the profile
// (`[Film Simulation] ClutParams=name=v1,v2;name2=v;`). Pure, so that it can be tested.

import type { ClutInfo, ClutParam, LutEntry } from "./api.js";
import type { ChoiceDef, ControlDef, Getter, SliderDef, ToggleDef } from "./tools.js";
import type { Params } from "./live.js";

export const GROUP = "Film Simulation";
const KEY = "ClutParams";

export type ParamValues = Record<string, number[]>;

/** the values of the profile's `ClutParams` (its text, or the object a patch put there) */
export function parseClutParams(v: unknown): ParamValues {
    const out: ParamValues = {};
    if (typeof v === "string") {
        for (const entry of v.split(";")) {
            const eq = entry.indexOf("=");
            if (eq <= 0) continue;
            const nums = entry.slice(eq + 1).split(",").map(Number);
            if (nums.length && nums.every(Number.isFinite)) out[entry.slice(0, eq)] = nums;
        }
    } else if (v && typeof v === "object") {
        for (const [k, a] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(a)) out[k] = a.map(Number);
    }
    return out;
}

/** every parameter with its value: the profile's, else the script's default */
export function withDefaults(info: ClutInfo, v: ParamValues): ParamValues {
    const out: ParamValues = {};
    for (const p of info.params) out[p.name] = [...(v[p.name] ?? p.default)];
    return out;
}

/** the name to show for the LUT of the profile (a path or a `file://` URI) or of an id of the host */
export function lutName(key: unknown, known?: { id: string; name: string } | null): string {
    if (typeof key !== "string" || key === "") return "";
    if (known && key === known.id) return known.name;
    let p = key.replace(/^file:\/\//, "");
    try {
        p = decodeURIComponent(p);
    } catch {
        /* not escaped */
    }
    return p.slice(p.lastIndexOf("/") + 1);
}

/**
 * The LUT of MART's folder that the profile means: its key is the id just chosen, or a path or a URI (`file://R/...`,
 * or an absolute one: the folder is not told, so the end of the path is compared). Null if it is none of them.
 */
export function matchLut(key: unknown, luts: LutEntry[]): LutEntry | null {
    if (typeof key !== "string" || key === "") return null;
    const byId = luts.find((l) => l.id === key);
    if (byId) return byId;
    const m = /^file:\/\/[^/]*(\/.*)$/.exec(key);
    let p = m ? m[1]! : key;
    try {
        p = decodeURIComponent(p);
    } catch {
        /* not escaped */
    }
    let best: LutEntry | null = null;
    for (const l of luts)
        if ((p === l.name || p === "/" + l.name || p.endsWith("/" + l.name)) && (!best || l.name.length > best.name.length)) best = l;
    return best;
}

/** a key that is an id of the host (a LUT just chosen) rather than what the engine reports */
export const isLutId = (key: unknown): boolean => typeof key === "string" && /^(u\d+|d\d+:.+)$/.test(key);

const digits = (step: number): number => (step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))));

/** reads and writes element `i` of parameter `p` */
function accessors(info: ClutInfo, p: ClutParam, i: number, toUi: (v: number) => number, fromUi: (v: number) => number) {
    return {
        read: (params: Params): number => {
            const v = parseClutParams(params[GROUP]?.[KEY])[p.name]?.[i] ?? p.default[i] ?? 0;
            return toUi(v);
        },
        write: (value: unknown, get: Getter): Record<string, unknown> => {
            const all = withDefaults(info, parseClutParams(get(GROUP, KEY)));
            const list = all[p.name] ?? [];
            list[i] = fromUi(Number(value));
            all[p.name] = list;
            return { [KEY]: all };
        },
    };
}

/** the controls for the parameters of a script; curves cannot be edited here, only listed */
export function paramDefs(info: ClutInfo): ControlDef[] {
    const defs: ControlDef[] = [];
    let group = "";
    for (const p of info.params) {
        if (p.group && p.group !== group) defs.push({ kind: "heading", label: p.group, group: GROUP });
        group = p.group || group;
        const base = { label: p.label || p.name, group: GROUP, key: KEY };
        const id = (v: number): number => v;
        switch (p.type) {
            case "float":
            case "int": {
                const a = accessors(info, p, 0, id, p.type === "int" ? Math.round : id);
                const d: SliderDef = { ...base, kind: "slider", min: p.min, max: p.max, step: p.step || (p.type === "int" ? 1 : 0.01), def: p.default[0] ?? 0, digits: p.type === "int" ? 0 : digits(p.step || 0.01), ...a };
                defs.push(d);
                break;
            }
            case "bool": {
                const a = accessors(info, p, 0, (v) => v, (v) => (v ? 1 : 0));
                const d: ToggleDef = { ...base, kind: "toggle", def: (p.default[0] ?? 0) !== 0, read: (params) => a.read(params) !== 0, write: a.write };
                defs.push(d);
                break;
            }
            case "choice": {
                const a = accessors(info, p, 0, id, id);
                const d: ChoiceDef = { ...base, kind: "choice", options: (p.choices ?? []).map((c) => ({ value: c.value, label: c.label })), def: p.default[0] ?? 0, ...a };
                defs.push(d);
                break;
            }
            case "huesat": {
                // hue in radians and saturation: the hue is shown in degrees
                const h = accessors(info, p, 0, (v) => (v * 180) / Math.PI, (v) => (v * Math.PI) / 180);
                const s = accessors(info, p, 1, id, id);
                defs.push({ ...base, label: `${base.label}: hue`, kind: "slider", min: -180, max: 180, step: 1, def: ((p.default[0] ?? 0) * 180) / Math.PI, digits: 0, ...h });
                defs.push({ ...base, label: `${base.label}: saturation`, kind: "slider", min: 0, max: 1, step: 0.01, def: p.default[1] ?? 0, digits: 2, ...s });
                break;
            }
            default:
                // a curve: kept as it is in the profile
                defs.push({ kind: "heading", label: `${p.label || p.name}: a curve, edit it in ART`, group: GROUP });
        }
    }
    return defs;
}

/** a row of chips that sets all the parameters at once: the presets of the script, and "reset" */
export function presetsDef(info: ClutInfo): ChoiceDef | null {
    if (!info.params.length) return null;
    const options = [...info.presets.map((p) => ({ value: p.key, label: p.label })), { value: "", label: "Reset" }];
    return {
        kind: "choice",
        label: "Presets",
        group: GROUP,
        key: KEY,
        options,
        def: "-",
        read: () => "-", // none stays selected: choosing is an action, not a state
        write: (value) => {
            const preset = info.presets.find((p) => p.key === value);
            return { [KEY]: preset ? withDefaults(info, preset.values) : {} };
        },
    };
}

/** chooses a LUT (an id of the host), or none (""): its parameters start from the defaults */
export const lutDef: ChoiceDef = {
    kind: "choice",
    label: "LUT",
    group: GROUP,
    key: "ClutFilename",
    options: [],
    def: "",
    write: (value) => ({ ClutFilename: String(value), ClutParams: {}, Enabled: value !== "" }),
};
