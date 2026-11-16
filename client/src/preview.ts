// The preview canvas: shows the last frame from the server, pinch/pan/zoom
// with instant feedback (the frame is just redrawn with the new transform),
// and tells its owner when the view has settled, so that a sharp frame of the
// visible region is requested. Frames arrive through setFrame(); the server
// keeps at most one render in flight (latest wins).

import type { Region } from "./api.js";
import type { ViewRequest } from "./live.js";

interface Frame {
    bitmap: ImageBitmap;
    region: Region;
}

const MAX_ZOOM = 4; // CSS pixels per image pixel
const SETTLE_MS = 90;
const PAD = 16; // CSS px of margin around the image when it is fitted: room for the crop handles

export class PreviewView {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private onSettled: () => void;

    // the part of the image shown (the whole image, or the crop): its origin and size
    private bx = 0;
    private by = 0;
    private iw = 0;
    private ih = 0;
    private zoom = 1;
    private tx = 0; // screen = image * zoom + t (CSS pixels)
    private ty = 0;
    private frame: Frame | null = null;
    private fitted = true; // the image is fitted to the view (and follows its size)

    private settleTimer = 0;
    private drawQueued = false;

    private pointers = new Map<number, { x: number; y: number }>();
    private lastTap = 0;
    private downAt: { x: number; y: number; t: number } | null = null;

    /** called after every draw (the crop overlay follows the view) */
    afterDraw: (() => void) | null = null;
    /** a tap (not a drag) at this point of the image, if set */
    onTap: ((x: number, y: number) => void) | null = null;
    /** any tap on the picture, wherever it is */
    onAnyTap: (() => void) | null = null;

    constructor(canvas: HTMLCanvasElement, onSettled: () => void) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.onSettled = onSettled;
        new ResizeObserver(() => this.resize()).observe(canvas);
        canvas.addEventListener("pointerdown", (e) => this.down(e));
        canvas.addEventListener("pointermove", (e) => this.move(e));
        canvas.addEventListener("pointerup", (e) => this.up(e));
        canvas.addEventListener("pointercancel", (e) => this.up(e));
        canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
        this.resize();
    }

    /** A new image (or a new size of it): reset to fit. The owner then asks for a frame. */
    setImage(w: number, h: number): void {
        this.bx = this.by = 0;
        this.iw = w;
        this.ih = h;
        this.frame?.bitmap.close();
        this.frame = null;
        this.fit();
        this.queueDraw();
    }

    /** Show only this part of the image (the cropped view); null: the whole image. The owner is told to refresh. */
    setBounds(r: Region | null, full: { w: number; h: number }): void {
        const n = r ?? { x: 0, y: 0, w: full.w, h: full.h };
        if (n.x === this.bx && n.y === this.by && n.w === this.iw && n.h === this.ih) return;
        this.bx = n.x;
        this.by = n.y;
        this.iw = n.w;
        this.ih = n.h;
        this.fit();
        this.changed();
    }

    /** image coordinates -> CSS pixels of the canvas, and back */
    toScreen(x: number, y: number): { x: number; y: number } {
        return { x: (x - this.bx) * this.zoom + this.tx, y: (y - this.by) * this.zoom + this.ty };
    }
    toImage(px: number, py: number): { x: number; y: number } {
        return { x: (px - this.tx) / this.zoom + this.bx, y: (py - this.ty) / this.zoom + this.by };
    }
    /** the layout, for the browser tests */
    layout(): { zoom: number; fitZoom: number; fitted: boolean; cssW: number; cssH: number } {
        return { zoom: this.zoom, fitZoom: this.fitZoom, fitted: this.fitted, cssW: this.cssW, cssH: this.cssH };
    }
    /** the part of the image shown */
    getBounds(): Region {
        return { x: this.bx, y: this.by, w: this.iw, h: this.ih };
    }
    /** CSS pixels per image pixel */
    get scale(): number {
        return this.zoom;
    }

    /** A frame from the server, rendered for `region` of the image. */
    setFrame(bitmap: ImageBitmap, region: Region): void {
        this.frame?.bitmap.close();
        this.frame = { bitmap, region };
        this.queueDraw();
    }

    /**
     * What to ask the server for: the visible part of the image, at the
     * resolution of the screen but never above the image's own. `draft` is half
     * of that, for the frames of a slider drag.
     */
    request(draft = false): ViewRequest | null {
        const region = this.visible();
        if (!region) return null;
        const dpr = window.devicePixelRatio || 1;
        const full = Math.min(region.w, region.w * this.zoom * dpr);
        return { ...region, out_w: Math.max(1, Math.round(draft ? full / 2 : full)) };
    }

    private get cssW(): number {
        return this.canvas.clientWidth;
    }
    private get cssH(): number {
        return this.canvas.clientHeight;
    }
    private get fitZoom(): number {
        return this.iw && this.ih ? Math.min((this.cssW - 2 * PAD) / this.iw, (this.cssH - 2 * PAD) / this.ih) : 1;
    }

    private resize(): void {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(this.cssW * dpr));
        this.canvas.height = Math.max(1, Math.round(this.cssH * dpr));
        if (this.iw) {
            // a fitted image follows the size of the view (judged by the flag: the old zoom is for the old size)
            if (this.fitted) this.fit();
            else this.clamp();
            this.changed();
        }
        this.draw();
    }

    private fit(): void {
        this.fitted = true;
        this.zoom = this.fitZoom;
        this.tx = (this.cssW - this.iw * this.zoom) / 2;
        this.ty = (this.cssH - this.ih * this.zoom) / 2;
    }

    private clamp(): void {
        const min = this.fitZoom;
        this.zoom = Math.min(Math.max(this.zoom, min), Math.max(MAX_ZOOM, min));
        const sw = this.iw * this.zoom;
        const sh = this.ih * this.zoom;
        this.tx = sw <= this.cssW ? (this.cssW - sw) / 2 : Math.min(0, Math.max(this.cssW - sw, this.tx));
        this.ty = sh <= this.cssH ? (this.cssH - sh) / 2 : Math.min(0, Math.max(this.cssH - sh, this.ty));
        // zoomed out as far as it goes: that is the fitted view again
        if (this.zoom <= min * 1.0001) this.fit();
    }

    private zoomAt(factor: number, cx: number, cy: number): void {
        const z = Math.min(Math.max(this.zoom * factor, this.fitZoom), Math.max(MAX_ZOOM, this.fitZoom));
        const f = z / this.zoom;
        this.tx = cx - (cx - this.tx) * f;
        this.ty = cy - (cy - this.ty) * f;
        this.zoom = z;
        this.fitted = false;
        this.clamp();
    }

    private changed(): void {
        this.queueDraw();
        window.clearTimeout(this.settleTimer);
        this.settleTimer = window.setTimeout(() => this.onSettled(), SETTLE_MS);
    }

    // ---- gestures ----------------------------------------------------------

    private pos(e: PointerEvent): { x: number; y: number } {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    private down(e: PointerEvent): void {
        this.canvas.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, this.pos(e));
        if (this.pointers.size === 1) {
            const now = performance.now();
            if (now - this.lastTap < 300) this.toggleZoom(this.pos(e));
            this.lastTap = now;
            this.downAt = { ...this.pos(e), t: now };
        } else {
            this.downAt = null; // a second finger: not a tap
        }
    }

    private move(e: PointerEvent): void {
        const old = this.pointers.get(e.pointerId);
        if (!old || !this.iw) return;
        const now = this.pos(e);
        if (this.pointers.size === 1) {
            this.tx += now.x - old.x;
            this.ty += now.y - old.y;
            this.clamp();
        } else if (this.pointers.size === 2) {
            const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
            const d0 = Math.hypot(old.x - other.x, old.y - other.y);
            const d1 = Math.hypot(now.x - other.x, now.y - other.y);
            const c0 = { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 };
            const c1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
            this.tx += c1.x - c0.x;
            this.ty += c1.y - c0.y;
            if (d0 > 0) this.zoomAt(d1 / d0, c1.x, c1.y);
            else this.clamp();
        }
        this.pointers.set(e.pointerId, now);
        this.changed();
    }

    private up(e: PointerEvent): void {
        const d = this.downAt;
        this.pointers.delete(e.pointerId);
        if (d && e.type === "pointerup" && performance.now() - d.t < 400) {
            const p = this.pos(e);
            if (Math.hypot(p.x - d.x, p.y - d.y) < 8) {
                this.onAnyTap?.();
                const i = this.toImage(p.x, p.y);
                this.onTap?.(i.x, i.y);
            }
        }
        this.downAt = null;
    }

    private wheel(e: WheelEvent): void {
        e.preventDefault();
        if (!this.iw) return;
        const p = this.pos(e as unknown as PointerEvent);
        this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
        this.changed();
    }

    private toggleZoom(p: { x: number; y: number }): void {
        if (!this.iw) return;
        if (this.zoom > this.fitZoom * 1.05) this.fit();
        else this.zoomAt(Math.max(1, this.fitZoom * 2) / this.zoom, p.x, p.y);
        this.changed();
    }

    // ---- frames ------------------------------------------------------------

    private visible(): Region | null {
        if (!this.iw) return null;
        const x0 = Math.max(0, Math.floor(-this.tx / this.zoom));
        const y0 = Math.max(0, Math.floor(-this.ty / this.zoom));
        const x1 = Math.min(this.iw, Math.ceil((this.cssW - this.tx) / this.zoom));
        const y1 = Math.min(this.ih, Math.ceil((this.cssH - this.ty) / this.zoom));
        if (x1 <= x0 || y1 <= y0) return null;
        return { x: this.bx + x0, y: this.by + y0, w: x1 - x0, h: y1 - y0 };
    }

    // ---- drawing -----------------------------------------------------------

    private queueDraw(): void {
        if (this.drawQueued) return;
        this.drawQueued = true;
        requestAnimationFrame(() => {
            this.drawQueued = false;
            this.draw();
        });
    }

    private draw(): void {
        const dpr = window.devicePixelRatio || 1;
        const c = this.ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const f = this.frame;
        if (f) {
            c.imageSmoothingQuality = "high";
            c.drawImage(
                f.bitmap,
                ((f.region.x - this.bx) * this.zoom + this.tx) * dpr,
                ((f.region.y - this.by) * this.zoom + this.ty) * dpr,
                f.region.w * this.zoom * dpr,
                f.region.h * this.zoom * dpr,
            );
        }
        this.afterDraw?.();
    }
}
