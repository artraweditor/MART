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

// The Crop tab: rotate, flip, aspect ratio. What the crop rectangle and the
// ratio mean in the profile
// (keys of [Crop]), and the controls that change them.

import { clampRect } from "./crop.js";
import type { Rect } from "./crop.js";
import type { Params, Patch } from "./live.js";
import { el } from "./sheet.js";

/**
 * The ratios offered, as ART names them: long side : short side (the
 * orientation is a separate key).
 */
export const RATIO_KEYS = ["As Image", "1:1", "4:3", "3:2", "16:9"] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];

const LABELS: Record<RatioKey, string> = {
    "As Image": "Original",
    "1:1": "1:1",
    "4:3": "4:3",
    "3:2": "3:2",
    "16:9": "16:9",
};

/** width / height of the rectangle for a ratio, in an image of W x H */
export function ratioFor(
    key: RatioKey,
    W: number,
    H: number,
    portrait: boolean,
): number {
    if (key === "As Image") return W / H;
    const [a, b] = key.split(":").map(Number) as [number, number];
    const r = a / b; // >= 1
    return portrait ? 1 / r : r;
}

export interface CropState {
    enabled: boolean;
    rect: Rect; // the whole image if there is no crop
    ratio: RatioKey | null; // the locked ratio, null for a free crop
    portrait: boolean;
}

/** The crop in the parameters of the image. */
export function cropFromParams(
    params: Params,
    W: number,
    H: number,
): CropState {
    const p = params["Crop"] ?? {};
    const n = (k: string): number =>
        typeof p[k] === "number" ? (p[k] as number) : -1;
    const enabled =
        p["Enabled"] === true &&
        n("W") > 0 &&
        n("H") > 0 &&
        n("X") >= 0 &&
        n("Y") >= 0;
    const rect = enabled
        ? clampRect({ x: n("X"), y: n("Y"), w: n("W"), h: n("H") }, W, H)
        : { x: 0, y: 0, w: W, h: H };
    const r = p["Ratio"];
    const ratio =
        p["FixedRatio"] === true &&
        (RATIO_KEYS as readonly unknown[]).includes(r)
            ? (r as RatioKey)
            : null;
    return {
        enabled,
        rect,
        ratio,
        portrait:
            p["Orientation"] === "Portrait" ||
            (p["Orientation"] !== "Landscape" && rect.h > rect.w),
    };
}

/** The patch that sets the crop (and turns it on). */
export function cropPatch(rect: Rect, ratio: RatioKey | null): Patch {
    const crop: Record<string, unknown> = {
        Enabled: true,
        X: rect.x,
        Y: rect.y,
        W: rect.w,
        H: rect.h,
        FixedRatio: ratio !== null,
    };
    if (ratio) {
        crop["Ratio"] = ratio;
        crop["Orientation"] =
            ratio === "As Image"
                ? "As Image"
                : rect.w >= rect.h
                  ? "Landscape"
                  : "Portrait";
    }
    return { Crop: crop };
}

export interface CropTabHost {
    turn(degrees: 90 | 270): void;
    flip(axis: "h" | "v"): void;
    pickRatio(key: RatioKey | null): void;
    swap(): void;
    reset(): void;
}

export interface CropTab {
    el: HTMLElement;
    sync(state: CropState): void;
}

export function buildCropTab(host: CropTabHost): CropTab {
    const root = el("div", { class: "croptool" });
    const group = (title: string, ...kids: HTMLElement[]): HTMLElement => {
        const g = el(
            "div",
            { class: "ctl" },
            el("div", { class: "row" }, el("label", { text: title })),
        );
        g.append(el("div", { class: "chips" }, ...kids));
        return g;
    };
    const btn = (
        text: string,
        label: string,
        fn: () => void,
    ): HTMLButtonElement => {
        const b = el("button", { class: "chip", text });
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.addEventListener("click", fn);
        return b;
    };
    const turns = group(
        "Rotate and flip",
        btn("↺ 90°", "Rotate left", () => host.turn(270)),
        btn("↻ 90°", "Rotate right", () => host.turn(90)),
        btn("⇆ Flip", "Flip horizontally", () => host.flip("h")),
        btn("⇅ Flip", "Flip vertically", () => host.flip("v")),
    );
    const chips = new Map<RatioKey | "free", HTMLButtonElement>();
    const free = btn("Free", "Free crop", () => host.pickRatio(null));
    chips.set("free", free);
    const ratioButtons: HTMLElement[] = [free];
    for (const k of RATIO_KEYS) {
        const b = btn(LABELS[k], `Crop to ${LABELS[k]}`, () =>
            host.pickRatio(k),
        );
        b.setAttribute("role", "radio");
        chips.set(k, b);
        ratioButtons.push(b);
    }
    free.setAttribute("role", "radio");
    const swap = btn("⇄ Swap", "Swap landscape and portrait", () =>
        host.swap(),
    );
    ratioButtons.push(swap);
    const ratios = group("Aspect ratio", ...ratioButtons);
    const reset = btn("Remove the crop", "Remove the crop", () => host.reset());
    reset.classList.add("wide");
    root.append(turns, ratios, el("div", { class: "ctl" }, reset));
    return {
        el: root,
        sync(s) {
            for (const [k, b] of chips)
                b.setAttribute(
                    "aria-checked",
                    String(k === (s.ratio ?? "free")),
                );
            swap.disabled =
                s.ratio === null || s.ratio === "As Image" || s.ratio === "1:1";
            reset.disabled = !s.enabled;
        },
    };
}
