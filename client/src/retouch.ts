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

// The Retouch tab: regions of ART's "Color/tone correction" tool, in perceptual
// mode, with a simplified interface (hue
// shift, saturation, gain, lift, gamma, pivot, compression) and an optional
// brush mask. The host keeps them as regions
// of the tool, after those of the sidecar, and tells us about them as
// `params.Retouch` (by id); we change them with
// patches of the form {Retouch: {<id>: {fields}}} (null removes a region). See
// host/src/retouch.h.

import { makeControl, registerControl } from "./controls.js";
import type { Control, ControlHost } from "./controls.js";
import type { Params } from "./live.js";
import type { BrushHandler, PreviewView } from "./preview.js";
import { el } from "./sheet.js";
import type { ControlDef, SliderDef, ToggleDef } from "./tools.js";

export const GROUP = "Retouch";
/** more than this is more than the screen can hold */
const MAX_REGIONS = 12;

/**
 * a group of strokes: [radius (0..1 of a quarter of the short side), paint (1)
 * or erase (0), hardness, x1, y1, ...]
 */
export type StrokeGroup = number[];

interface Field {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    def: number; // the value of the slider when the setting has its default
    digits: number;
    toUi: (stored: number) => number;
    toStored: (ui: number) => number;
}

const same = (v: number): number => v;
const log2 = (v: number): number => Math.log2(Math.max(v, 1e-6));
const pow2 = (v: number): number => Math.round(2 ** v * 1e4) / 1e4;

/**
 * gain, gamma and pivot are multipliers: their sliders are in stops (the base 2
 * logarithm), 0 being "no change"
 */
export const TONE_FIELDS: Field[] = [
    {
        key: "HueShift",
        label: "Hue shift",
        min: -180,
        max: 180,
        step: 1,
        def: 0,
        digits: 0,
        toUi: same,
        toStored: same,
    },
    {
        key: "OutSaturation",
        label: "Saturation",
        min: -100,
        max: 100,
        step: 1,
        def: 0,
        digits: 0,
        toUi: same,
        toStored: same,
    },
    {
        key: "Slope",
        label: "Highlights (gain)",
        min: -4,
        max: 4,
        step: 0.01,
        def: 0,
        digits: 2,
        toUi: log2,
        toStored: pow2,
    },
    {
        key: "Offset",
        label: "Shadows (lift)",
        min: -0.15,
        max: 0.15,
        step: 0.001,
        def: 0,
        digits: 3,
        toUi: same,
        toStored: same,
    },
    {
        key: "Power",
        label: "Midtones (gamma)",
        min: -2,
        max: 2,
        step: 0.01,
        def: 0,
        digits: 2,
        toUi: log2,
        toStored: pow2,
    },
    {
        key: "Pivot",
        label: "Pivot",
        min: -8,
        max: 1,
        step: 0.01,
        def: 0,
        digits: 2,
        toUi: log2,
        toStored: pow2,
    },
    {
        key: "Compression",
        label: "Compression",
        min: 0,
        max: 1,
        step: 0.01,
        def: 0,
        digits: 2,
        toUi: same,
        toStored: same,
    },
];
/**
 * the details of the region: local contrast limited to it, as the "Fine" of
 * the Local contrast tool (a region of that tool, with a mask linked to this
 * one: host/src/localcontrast.cc)
 */
const DETAILS_FIELD: Field = {
    key: "Details",
    label: "Details",
    min: -100,
    max: 100,
    step: 1,
    def: 0,
    digits: 0,
    toUi: same,
    toStored: same,
};
const BRUSH_FIELDS: Field[] = [
    {
        key: "BrushFeather",
        label: "Feather",
        min: 0,
        max: 100,
        step: 0.1,
        def: 0,
        digits: 1,
        toUi: same,
        toStored: same,
    },
    {
        key: "BrushOpacity",
        label: "Opacity",
        min: 0,
        max: 100,
        step: 1,
        def: 100,
        digits: 0,
        toUi: same,
        toStored: same,
    },
    {
        key: "BrushSmoothness",
        label: "Smoothness",
        min: 0,
        max: 100,
        step: 1,
        def: 0,
        digits: 0,
        toUi: same,
        toStored: same,
    },
];
const FIELDS = new Map(
    [...TONE_FIELDS, DETAILS_FIELD, ...BRUSH_FIELDS].map((f) => [f.key, f]),
);

/**
 * what a region has before anything is set (what host/src/retouch.cc writes for
 * a new one)
 */
export const DEFAULTS: Record<string, unknown> = {
    Enabled: false,
    HueShift: 0,
    OutSaturation: 0,
    Slope: 1,
    Offset: 0,
    Power: 1,
    Pivot: 1,
    Compression: 0,
    Details: 0,
    BrushEnabled: false,
    BrushFeather: 0,
    BrushOpacity: 100,
    BrushSmoothness: 0,
    Strokes: [],
};

/** apply a patch of the retouch regions to the parameters, as the host will */
export function mergeRetouch(
    params: Params,
    patch: Record<string, unknown>,
): void {
    const cur = (params[GROUP] ??= {});
    for (const [id, v] of Object.entries(patch)) {
        if (v === null) delete cur[id];
        else
            cur[id] = {
                ...((cur[id] as object | undefined) ?? DEFAULTS),
                ...(v as object),
            };
    }
}

/**
 * the ids of the regions, in the order they are applied (the order the host
 * made them in: ascending)
 */
export function regionIds(params: Params): string[] {
    return Object.keys(params[GROUP] ?? {}).sort(
        (a, b) => Number(a) - Number(b),
    );
}

/** the number of dabs of a list of stroke groups */
export function dabCount(groups: StrokeGroup[]): number {
    return groups.reduce((n, g) => n + Math.max(0, (g.length - 3) / 2), 0);
}

/**
 * The dabs along a line, as ART's own brush makes them: one every 0.3 of the
 * radius of a dab. `from` is the last dab
 * (null at the start of a stroke), the result are the positions after it, up to
 * and including `to` when it is far enough.
 */
export function dabsAlong(
    from: { x: number; y: number } | null,
    to: { x: number; y: number },
    spacing: number,
): { x: number; y: number }[] {
    if (!from) return [to];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    const n = Math.floor(d / Math.max(spacing, 1e-6));
    const out: { x: number; y: number }[] = [];
    for (let i = 1; i <= n; i++)
        out.push({
            x: from.x + (dx / d) * spacing * i,
            y: from.y + (dy / d) * spacing * i,
        });
    return out;
}

// ---- the brush --------------------------------------------------------------

// the size is ART's slider (0.1..100), a dab has a radius of size/400 of the
// short side
const pen = { size: 10, hardness: 100, erase: false };

let preview: PreviewView | null = null;
let imageSize = (): { w: number; h: number } => ({ w: 0, h: 0 });
let panelHost: ControlHost | null = null;
let latest: Params = {};
let active = false; // the Retouch tab is shown
let openId: string | null = null; // the region that is open
// the region whose mask is being edited: the picture paints on it
let paintId: string | null = null;
// its strokes as edited, not yet committed (the preview does not show them)
let pending: StrokeGroup[] | null = null;
// update the panel after a change that does not come from the host
let refresh: () => void = () => {};
// the stroke in progress: x, y of its dabs, as fractions of the image
let cur: number[] | null = null;
let lastDab: { x: number; y: number } | null = null; // in pixels of the image
let offscreen: HTMLCanvasElement | null = null;

const region = (id: string | null): Record<string, unknown> | undefined =>
    id
        ? (latest[GROUP]?.[id] as Record<string, unknown> | undefined)
        : undefined;
const strokesOf = (id: string | null): StrokeGroup[] =>
    (region(id)?.["Strokes"] as StrokeGroup[] | undefined) ?? [];
/** the strokes to show: those being edited, or the region's */
const shownStrokes = (id: string | null): StrokeGroup[] =>
    id !== null && id === paintId && pending ? pending : strokesOf(id);

/**
 * leave the editing of the mask: `commit` sends the strokes (the preview then
 * shows them), otherwise they are dropped
 */
function endEdit(commit: boolean): void {
    const id = paintId;
    const strokes = pending;
    paintId = null;
    pending = null;
    if (
        commit &&
        id !== null &&
        strokes &&
        panelHost &&
        JSON.stringify(strokes) !== JSON.stringify(strokesOf(id))
    ) {
        panelHost.raw(
            {
                [GROUP]: {
                    [id]: {
                        Enabled: true,
                        BrushEnabled: true,
                        Strokes: strokes,
                    },
                },
            },
            "",
        );
    }
    refresh();
}

function updateBrush(): void {
    if (!preview) return;
    const ok =
        active &&
        paintId !== null &&
        region(paintId)?.["BrushEnabled"] === true &&
        region(paintId)?.["Enabled"] !== undefined;
    preview.brush = ok ? handler : null;
    preview.redraw();
}

const handler: BrushHandler = {
    start(x, y) {
        cur = [];
        lastDab = null;
        addDab(x, y);
        preview?.redraw();
    },
    move(x, y) {
        if (!cur) return;
        addDab(x, y);
        preview?.redraw();
    },
    end() {
        const dabs = cur;
        cur = null;
        lastDab = null;
        if (pending && dabs && dabs.length)
            pending.push([
                pen.size / 100,
                pen.erase ? 0 : 1,
                pen.hardness / 100,
                ...dabs,
            ]);
        preview?.redraw();
        refresh();
    },
    cancel() {
        cur = null;
        lastDab = null;
        preview?.redraw();
    },
};

function addDab(x: number, y: number): void {
    const { w, h } = imageSize();
    if (!w || !cur || cur.length > 2 * 20000) return;
    const spacing = Math.min(w, h) * (pen.size / 100) * 0.25 * 0.3;
    for (const p of dabsAlong(lastDab, { x, y }, spacing)) {
        cur.push(
            Math.min(Math.max(p.x / w, -0.5), 1.5),
            Math.min(Math.max(p.y / h, -0.5), 1.5),
        );
        lastDab = p;
    }
}

/**
 * the overlay: where the brush mask of the region being edited is, in
 * translucent red
 */
function drawOverlay(ctx: CanvasRenderingContext2D, dpr: number): void {
    const r = region(openId);
    // only while the mask is being edited: a commit hides it, and the preview
    // shows the effect
    if (
        !active ||
        !preview ||
        !r ||
        r["BrushEnabled"] !== true ||
        paintId === null ||
        paintId !== openId
    )
        return;
    const { w, h } = imageSize();
    if (!w) return;
    const groups = [...shownStrokes(openId)];
    if (cur && cur.length)
        groups.push([
            pen.size / 100,
            pen.erase ? 0 : 1,
            pen.hardness / 100,
            ...cur,
        ]);
    if (!groups.length) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (!offscreen) offscreen = document.createElement("canvas");
    if (offscreen.width !== cw || offscreen.height !== ch) {
        offscreen.width = cw;
        offscreen.height = ch;
    }
    const o = offscreen.getContext("2d")!;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, cw, ch);
    o.strokeStyle = "#ff3030";
    o.lineCap = "round";
    o.lineJoin = "round";
    const minDim = Math.min(w, h);
    for (const g of groups) {
        o.globalCompositeOperation =
            g[1] === 0 ? "destination-out" : "source-over";
        o.lineWidth = Math.max(
            1,
            2 * minDim * g[0]! * 0.25 * preview.scale * dpr,
        );
        o.beginPath();
        for (let i = 3; i + 1 < g.length; i += 2) {
            const p = preview.toScreen(g[i]! * w, g[i + 1]! * h);
            if (i === 3) o.moveTo(p.x * dpr, p.y * dpr);
            o.lineTo(p.x * dpr, p.y * dpr);
        }
        o.stroke();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
}

/**
 * connect the brush to the picture; `size` is the size of the image as
 * `preview` shows it
 */
export function attachRetouch(
    view: PreviewView,
    size: () => { w: number; h: number },
): void {
    preview = view;
    imageSize = size;
    view.drawOverlay = drawOverlay;
}

/**
 * the Retouch tab is shown (or not): the brush works and the mask is drawn only
 * then
 */
export function setRetouchActive(on: boolean): void {
    active = on;
    if (!on) endEdit(true); // leaving the tab keeps what was painted
    updateBrush();
}

// ---- the panel --------------------------------------------------------------

interface RegionUI {
    id: string;
    group: HTMLElement;
    toggle: HTMLButtonElement;
    brushBox: HTMLElement;
    edit: HTMLElement;
    editBox: HTMLElement;
    count: HTMLElement;
    controls: Control[];
}

registerControl("retouch", (_def, host: ControlHost): Control => {
    panelHost = host;
    const root = el("div", { class: "retouch" });
    const list = el("div", { class: "regions" });
    const add = el("button", { class: "chip wide", text: "+ Add a region" });
    add.type = "button";
    add.addEventListener("click", () => {
        const ids = regionIds(latest);
        if (ids.length >= MAX_REGIONS) return;
        const id = String(Math.max(0, ...ids.map(Number)) + 1);
        endEdit(true);
        openId = id;
        host.raw({ [GROUP]: { [id]: { Enabled: true } } }, "");
    });
    root.append(list, el("div", { class: "ctl" }, add));

    // the controls of one region report their changes with the region's id
    const regionHost = (id: string): ControlHost => ({
        set(def: ControlDef, value: unknown, gesture: number) {
            if (def.kind === "heading" || def.kind === "custom") return;
            const f = FIELDS.get(def.key);
            let fields: Record<string, unknown>;
            if (def.key === "Enabled") fields = { Enabled: value === true };
            else if (def.key === "BrushEnabled")
                fields = { Enabled: true, BrushEnabled: value === true };
            else
                fields = {
                    Enabled: true,
                    [def.key]: f ? f.toStored(Number(value)) : value,
                };
            host.raw(
                { [GROUP]: { [id]: fields } },
                gesture ? `rt${id}.${def.key}#${gesture}` : "",
            );
        },
        gestureEnd: () => host.gestureEnd(),
        raw: (p, k) => host.raw(p, k),
    });
    // the pen belongs to the screen, not to a profile
    const penHost: ControlHost = {
        set(def, value) {
            if (def.kind === "heading" || def.kind === "custom") return;
            if (def.key === "size") pen.size = Number(value);
            else if (def.key === "hardness") pen.hardness = Number(value);
            else if (def.key === "erase") pen.erase = value === true;
        },
        gestureEnd() {},
        raw: () => {},
    };

    const slider = (id: string, f: Field, h: ControlHost): Control => {
        const def: SliderDef = {
            kind: "slider",
            label: f.label,
            group: GROUP,
            key: f.key,
            min: f.min,
            max: f.max,
            step: f.step,
            def: f.def,
            digits: f.digits,
            read: (p) => {
                const v = (
                    p[GROUP]?.[id] as Record<string, unknown> | undefined
                )?.[f.key];
                return typeof v === "number" ? f.toUi(v) : f.def;
            },
        };
        return makeControl(def, h);
    };
    const toggle = (
        label: string,
        key: string,
        h: ControlHost,
        read: (p: Params) => boolean,
        group = GROUP,
    ): Control => {
        const def: ToggleDef = {
            kind: "toggle",
            label,
            group,
            key,
            def: false,
            read,
        };
        return makeControl(def, h);
    };
    const penSlider = (
        label: string,
        key: "size" | "hardness",
        min: number,
        max: number,
        step: number,
        digits: number,
    ): Control => {
        const def: SliderDef = {
            kind: "slider",
            label,
            group: GROUP,
            key,
            min,
            max,
            step,
            def: key === "size" ? 10 : 100,
            digits,
            read: () => pen[key],
        };
        return makeControl(def, penHost);
    };

    const make = (id: string): RegionUI => {
        const rh = regionHost(id);
        const group = el("div", { class: "tool-group" });
        const head = el("h3", { class: "tool-heading" });
        const tgl = el("button", { class: "tool-toggle" });
        tgl.type = "button";
        head.append(tgl);
        const body = el("div", { class: "tool-body" });
        group.append(head, body);
        tgl.addEventListener("click", () => {
            endEdit(true);
            openId = openId === id ? null : id;
            apply();
        });

        const controls: Control[] = [];
        const put = (c: Control, into: HTMLElement = body): void => {
            controls.push(c);
            into.append(c.el);
        };
        put(
            toggle(
                "Enabled",
                "Enabled",
                rh,
                (p) =>
                    (p[GROUP]?.[id] as Record<string, unknown> | undefined)?.[
                        "Enabled"
                    ] === true,
            ),
        );
        for (const f of TONE_FIELDS) put(slider(id, f, rh));
        put(slider(id, DETAILS_FIELD, rh));

        // the brush mask
        const brushBox = el("div", { class: "brush-box" });
        const count = el("p", { class: "muted" });
        put(
            toggle(
                "Brush mask",
                "BrushEnabled",
                rh,
                (p) =>
                    (p[GROUP]?.[id] as Record<string, unknown> | undefined)?.[
                        "BrushEnabled"
                    ] === true,
            ),
        );
        const button = (
            text: string,
            fn: () => void,
            wide = true,
        ): HTMLButtonElement => {
            const x = el("button", {
                class: wide ? "chip wide" : "chip",
                text,
            });
            x.type = "button";
            x.addEventListener("click", fn);
            return x;
        };
        // the mask is edited in a mode of its own: strokes stay on the screen
        // until they are committed
        const edit = button("Edit the mask", () => {
            endEdit(true);
            paintId = id;
            pending = [...strokesOf(id)];
            refresh();
        });
        const editBox = el("div", { class: "edit-box" });
        const commit = button("Commit", () => endEdit(true));
        commit.classList.add("primary");
        const discard = button("Discard", () => endEdit(false), false);
        const undo = button(
            "Undo stroke",
            () => {
                pending?.pop();
                refresh();
            },
            false,
        );
        const clear = button(
            "Clear",
            () => {
                if (pending) pending.length = 0;
                refresh();
            },
            false,
        );
        const erase = toggle(
            "Erase instead of paint",
            "erase",
            penHost,
            () => pen.erase,
        );
        controls.push(erase);
        editBox.append(
            el("div", { class: "ctl" }, commit),
            el("div", { class: "chips" }, undo, clear, discard),
            erase.el,
        );
        for (const c of [
            penSlider("Size", "size", 0.1, 100, 0.1, 1),
            penSlider("Hardness", "hardness", 0, 100, 1, 0),
        ]) {
            controls.push(c);
            editBox.append(c.el);
        }
        editBox.append(count);
        brushBox.append(el("div", { class: "ctl" }, edit));
        for (const f of BRUSH_FIELDS) put(slider(id, f, rh), brushBox);
        brushBox.append(editBox);
        body.append(brushBox);

        const remove = el("button", {
            class: "chip wide",
            text: "Remove this region",
        });
        remove.type = "button";
        remove.addEventListener("click", () => {
            if (openId === id) openId = null;
            if (paintId === id) endEdit(false);
            host.raw({ [GROUP]: { [id]: null } }, "");
        });
        body.append(el("div", { class: "ctl" }, remove));
        return {
            id,
            group,
            toggle: tgl,
            brushBox,
            edit,
            editBox,
            count,
            controls,
        };
    };

    refresh = () => apply();
    let uis: RegionUI[] = [];
    let built = "";

    // the open region, the titles, and what the brush box shows
    const apply = (): void => {
        if (paintId !== null && region(paintId)?.["BrushEnabled"] !== true) {
            paintId = null; // the brush mask was switched off: nothing to edit
            pending = null;
        }
        uis.forEach((u, i) => {
            const r = region(u.id);
            const isOpen = u.id === openId;
            u.group.classList.toggle("open", isOpen);
            u.toggle.setAttribute("aria-expanded", String(isOpen));
            u.toggle.textContent =
                `Region ` +
                `${i + 1}${r?.["Enabled"] === true ? "" : " (off)"}`;
            u.brushBox.hidden = r?.["BrushEnabled"] !== true;
            const editing = u.id === paintId;
            u.edit.parentElement!.hidden = editing;
            u.editBox.hidden = !editing;
            const n = dabCount(shownStrokes(u.id));
            u.count.textContent = editing
                ? `${n} dabs painted: they show on the picture when you commit.`
                : n
                  ? `${n} dabs painted.`
                  : "Nothing painted yet: the region has no effect until you " +
                    "paint.";
            u.controls.forEach((c) => c.sync(latest));
        });
        updateBrush();
    };

    return {
        el: root,
        sync(params) {
            latest = params;
            const ids = regionIds(params);
            if (ids.join(",") !== built) {
                built = ids.join(",");
                uis = ids.map(make);
                list.replaceChildren(...uis.map((u) => u.group));
                if (openId === null || !ids.includes(openId))
                    openId = ids.length ? ids[0]! : null;
                if (paintId !== null && !ids.includes(paintId)) endEdit(false);
            }
            add.disabled = ids.length >= MAX_REGIONS;
            apply();
        },
    };
});
