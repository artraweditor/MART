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

// The crop tool: pure rectangle geometry, and the touch overlay that draws and
// edits the rectangle
// over the preview. Rectangles are in pixels of the image as `preview` shows it
// (what Crop X/Y/W/H use).

import type { PreviewView } from "./preview.js";

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

export const MIN_SIZE = 32;

const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(v, lo), hi);

/** The same rectangle moved/shrunk to lie inside the image. */
export function clampRect(r: Rect, W: number, H: number, min = MIN_SIZE): Rect {
    const w = clamp(Math.round(r.w), Math.min(min, W), W);
    const h = clamp(Math.round(r.h), Math.min(min, H), H);
    return {
        x: clamp(Math.round(r.x), 0, W - w),
        y: clamp(Math.round(r.y), 0, H - h),
        w,
        h,
    };
}

/**
 * The largest rectangle of aspect `ratio` (w/h) that fits inside `r`, centred
 * in it.
 */
export function fitRatio(r: Rect, ratio: number): Rect {
    let w = r.w;
    let h = w / ratio;
    if (h > r.h) {
        h = r.h;
        w = h * ratio;
    }
    return {
        x: Math.round(r.x + (r.w - w) / 2),
        y: Math.round(r.y + (r.h - h) / 2),
        w: Math.round(w),
        h: Math.round(h),
    };
}

/**
 * Drag `handle` of `start` by (dx, dy) image pixels. With `ratio` (w/h) the
 * aspect is kept: corners hold the
 * opposite corner, edges hold the opposite edge and stay centred on the other
 * axis. Always inside W x H.
 */
export function dragRect(
    start: Rect,
    handle: Handle,
    dx: number,
    dy: number,
    ratio: number | null,
    W: number,
    H: number,
    min = MIN_SIZE,
): Rect {
    if (handle === "move") {
        return clampRect(
            { ...start, x: start.x + dx, y: start.y + dy },
            W,
            H,
            min,
        );
    }
    const left = handle.includes("w");
    const right = handle.includes("e");
    const top = handle.includes("n");
    const bottom = handle.includes("s");
    const horizontal = left || right;
    const vertical = top || bottom;

    // the fixed edges
    // x of the fixed vertical edge
    const ax = left ? start.x + start.w : start.x;
    const ay = top ? start.y + start.h : start.y;

    if (!ratio) {
        let x0 = start.x,
            x1 = start.x + start.w,
            y0 = start.y,
            y1 = start.y + start.h;
        if (left) x0 = clamp(start.x + dx, 0, x1 - min);
        if (right) x1 = clamp(start.x + start.w + dx, x0 + min, W);
        if (top) y0 = clamp(start.y + dy, 0, y1 - min);
        if (bottom) y1 = clamp(start.y + start.h + dy, y0 + min, H);
        return {
            x: Math.round(x0),
            y: Math.round(y0),
            w: Math.round(x1 - x0),
            h: Math.round(y1 - y0),
        };
    }

    // with a locked ratio: decide the size from the dragged edge(s), then limit
    // it to the image
    let w: number;
    if (horizontal && vertical) {
        const wx = start.w + (left ? -dx : dx);
        const wy = (start.h + (top ? -dy : dy)) * ratio;
        w = Math.abs(wx - start.w) >= Math.abs(wy - start.w) ? wx : wy;
    } else if (horizontal) {
        w = start.w + (left ? -dx : dx);
    } else {
        w = (start.h + (top ? -dy : dy)) * ratio;
    }
    // room for the width: towards the dragged side from the fixed edge; the
    // height must fit too
    let maxW: number;
    if (horizontal) maxW = left ? ax : W - ax;
    else maxW = W;
    let maxH: number;
    if (vertical) maxH = top ? ay : H - ay;
    else {
        const cy = start.y + start.h / 2;
        maxH = 2 * Math.min(cy, H - cy); // centred on the other axis
    }
    if (!horizontal) {
        const cx = start.x + start.w / 2;
        maxW = Math.min(maxW, 2 * Math.min(cx, W - cx));
    }
    w = Math.min(w, maxW, maxH * ratio);
    w = Math.max(w, Math.min(min, min * ratio));
    if (w / ratio < min) w = min * ratio;
    const h = w / ratio;

    let x: number, y: number;
    if (horizontal) x = left ? ax - w : ax;
    else x = start.x + start.w / 2 - w / 2;
    if (vertical) y = top ? ay - h : ay;
    else y = start.y + start.h / 2 - h / 2;
    return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
    };
}

/**
 * Which handle of `r` is at (px, py), in CSS pixels, given the rectangle on
 * screen.
 */
export function hitHandle(
    r: Rect,
    px: number,
    py: number,
    reach: number,
): Handle | null {
    const near = (a: number, b: number) => Math.abs(a - b) <= reach;
    const l = near(px, r.x),
        rr = near(px, r.x + r.w),
        t = near(py, r.y),
        b = near(py, r.y + r.h);
    const inX = px > r.x - reach && px < r.x + r.w + reach;
    const inY = py > r.y - reach && py < r.y + r.h + reach;
    if (l && t) return "nw";
    if (rr && t) return "ne";
    if (l && b) return "sw";
    if (rr && b) return "se";
    // edges: only when the rectangle is big enough that the zones do not
    // swallow the inside
    if (t && inX) return "n";
    if (b && inX) return "s";
    if (l && inY) return "w";
    if (rr && inY) return "e";
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)
        return "move";
    return null;
}

const REACH = 24; // CSS px: a finger's reach around a handle (a 48 px target)

export class CropOverlay {
    private canvas: HTMLCanvasElement;
    private view: PreviewView;
    private hit: HTMLElement;
    private onCommit: (r: Rect) => void;
    /**
     * the center of the vignette filter, as ART has it: -100..100 of half the
     * width and height of the crop, from its middle; null when there is no
     * vignette to place
     */
    private vignette: { x: number; y: number } | null = null;
    onVignette: (x: number, y: number) => void = () => {};
    private vdrag: { id: number; start: { x: number; y: number } } | null =
        null;
    private rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
    private W = 0;
    private H = 0;
    private ratio: number | null = null;
    private active = false;
    private drag: {
        id: number;
        handle: Handle;
        px: number;
        py: number;
        start: Rect;
    } | null = null;

    constructor(
        canvas: HTMLCanvasElement,
        view: PreviewView,
        hit: HTMLElement,
        onCommit: (r: Rect) => void,
    ) {
        this.canvas = canvas;
        this.view = view;
        this.hit = hit;
        this.onCommit = onCommit;
        new ResizeObserver(() => this.draw()).observe(canvas);
        // capture phase: take the touches that start on the rectangle before
        // the view pans
        hit.addEventListener("pointerdown", (e) => this.down(e), {
            capture: true,
        });
        hit.addEventListener("pointermove", (e) => this.move(e), {
            capture: true,
        });
        hit.addEventListener("pointerup", (e) => this.up(e), { capture: true });
        hit.addEventListener("pointercancel", (e) => this.cancel(e), {
            capture: true,
        });
    }

    get imageRect(): Rect {
        return { ...this.rect };
    }

    setImageSize(w: number, h: number): void {
        this.W = w;
        this.H = h;
        this.rect = clampRect(
            this.rect.w ? this.rect : { x: 0, y: 0, w, h },
            w,
            h,
        );
        this.draw();
    }

    setRect(r: Rect): void {
        if (!this.drag) this.rect = this.W ? clampRect(r, this.W, this.H) : r;
        this.draw();
    }

    /** the aspect ratio (w/h) to keep, or null for free */
    setRatio(ratio: number | null): void {
        this.ratio = ratio;
    }

    /** show the center of the vignette (percent, see above), or hide it */
    setVignette(c: { x: number; y: number } | null): void {
        if (!this.vdrag) this.vignette = c;
        this.draw();
    }

    /** where the center of the vignette is on the screen */
    private vignetteScreen(c: { x: number; y: number }): {
        x: number;
        y: number;
    } {
        const r = this.rect;
        return this.view.toScreen(
            r.x + r.w / 2 + (c.x * r.w) / 200,
            r.y + r.h / 2 + (c.y * r.h) / 200,
        );
    }

    /** the vignette center for a point of the screen, rounded and limited */
    private vignetteAt(px: number, py: number): { x: number; y: number } {
        const i = this.view.toImage(px, py);
        const r = this.rect;
        const pct = (v: number): number =>
            Math.max(-100, Math.min(100, Math.round(v)));
        return {
            x: pct(((i.x - (r.x + r.w / 2)) * 200) / r.w),
            y: pct(((i.y - (r.y + r.h / 2)) * 200) / r.h),
        };
    }

    setActive(on: boolean): void {
        this.active = on;
        this.canvas.hidden = !on;
        this.draw();
    }

    private local(e: PointerEvent): { x: number; y: number } {
        const r = this.hit.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    private screenRect(r: Rect): Rect {
        const a = this.view.toScreen(r.x, r.y);
        return {
            x: a.x,
            y: a.y,
            w: r.w * this.view.scale,
            h: r.h * this.view.scale,
        };
    }

    private down(e: PointerEvent): void {
        if (!this.active || !this.W) return;
        if (this.vdrag) {
            // a second finger: the same
            this.vignette = this.vdrag.start;
            this.vdrag = null;
            this.draw();
            return;
        }
        if (this.drag) {
            // a second finger: give the gesture back to the view (pinch)
            this.rect = this.drag.start;
            this.drag = null;
            this.draw();
            return;
        }
        const p = this.local(e);
        if (this.vignette && this.rect.w > 0) {
            // the marker is above the crop handles
            const v = this.vignetteScreen(this.vignette);
            if (Math.hypot(p.x - v.x, p.y - v.y) <= REACH) {
                e.stopImmediatePropagation();
                this.hit.setPointerCapture(e.pointerId);
                this.vdrag = { id: e.pointerId, start: { ...this.vignette } };
                return;
            }
        }
        const handle = hitHandle(this.screenRect(this.rect), p.x, p.y, REACH);
        if (!handle) return;
        e.stopImmediatePropagation();
        this.hit.setPointerCapture(e.pointerId);
        this.drag = {
            id: e.pointerId,
            handle,
            px: p.x,
            py: p.y,
            start: { ...this.rect },
        };
    }

    private move(e: PointerEvent): void {
        const vd = this.vdrag;
        if (vd) {
            if (e.pointerId !== vd.id) return;
            e.stopImmediatePropagation();
            const p = this.local(e);
            this.vignette = this.vignetteAt(p.x, p.y);
            this.draw();
            return;
        }
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        e.stopImmediatePropagation();
        const p = this.local(e);
        const k = this.view.scale;
        this.rect = dragRect(
            d.start,
            d.handle,
            (p.x - d.px) / k,
            (p.y - d.py) / k,
            this.ratio,
            this.W,
            this.H,
        );
        this.draw();
    }

    private up(e: PointerEvent): void {
        const vd = this.vdrag;
        if (vd) {
            if (e.pointerId !== vd.id) return;
            e.stopImmediatePropagation();
            this.vdrag = null;
            const c = this.vignette;
            if (c && (c.x !== vd.start.x || c.y !== vd.start.y))
                this.onVignette(c.x, c.y);
            this.draw();
            return;
        }
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        e.stopImmediatePropagation();
        this.drag = null;
        if (
            this.rect.x !== d.start.x ||
            this.rect.y !== d.start.y ||
            this.rect.w !== d.start.w ||
            this.rect.h !== d.start.h
        )
            this.onCommit({ ...this.rect });
        this.draw();
    }

    private cancel(e: PointerEvent): void {
        const vd = this.vdrag;
        if (vd) {
            if (e.pointerId !== vd.id) return;
            this.vignette = vd.start;
            this.vdrag = null;
            this.draw();
            return;
        }
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        this.rect = d.start;
        this.drag = null;
        this.draw();
    }

    draw(): void {
        const dpr = window.devicePixelRatio || 1;
        const cw = this.canvas.clientWidth,
            ch = this.canvas.clientHeight;
        if (
            this.canvas.width !== Math.round(cw * dpr) ||
            this.canvas.height !== Math.round(ch * dpr)
        ) {
            this.canvas.width = Math.round(cw * dpr);
            this.canvas.height = Math.round(ch * dpr);
        }
        const c = this.canvas.getContext("2d")!;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, cw, ch);
        if (!this.active || !this.W) return;
        const s = this.screenRect(this.rect);
        // dim what is outside
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.beginPath();
        c.rect(0, 0, cw, ch);
        c.rect(s.x, s.y, s.w, s.h);
        c.fill("evenodd");
        // frame and thirds
        c.strokeStyle = "rgba(255,255,255,0.95)";
        c.lineWidth = 2;
        c.strokeRect(s.x, s.y, s.w, s.h);
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 1; i < 3; i++) {
            c.moveTo(s.x + (s.w * i) / 3, s.y);
            c.lineTo(s.x + (s.w * i) / 3, s.y + s.h);
            c.moveTo(s.x, s.y + (s.h * i) / 3);
            c.lineTo(s.x + s.w, s.y + (s.h * i) / 3);
        }
        c.stroke();
        // handles
        c.fillStyle = "#f0891a";
        const pts: [number, number][] = [
            [s.x, s.y],
            [s.x + s.w / 2, s.y],
            [s.x + s.w, s.y],
            [s.x, s.y + s.h / 2],
            [s.x + s.w, s.y + s.h / 2],
            [s.x, s.y + s.h],
            [s.x + s.w / 2, s.y + s.h],
            [s.x + s.w, s.y + s.h],
        ];
        for (const [x, y] of pts) {
            c.beginPath();
            c.arc(x, y, 7, 0, Math.PI * 2);
            c.fill();
        }
        // the center of the vignette: a ring with a cross, dark and light so
        // that it shows on any picture
        if (this.vignette) {
            const v = this.vignetteScreen(this.vignette);
            const R = 14;
            for (const [color, w] of [
                ["rgba(0,0,0,0.6)", 5],
                ["#ffffff", 2],
            ] as const) {
                c.strokeStyle = color;
                c.lineWidth = w;
                c.beginPath();
                c.arc(v.x, v.y, R, 0, Math.PI * 2);
                c.moveTo(v.x - R - 6, v.y);
                c.lineTo(v.x + R + 6, v.y);
                c.moveTo(v.x, v.y - R - 6);
                c.lineTo(v.x, v.y + R + 6);
                c.stroke();
            }
        }
    }
}
