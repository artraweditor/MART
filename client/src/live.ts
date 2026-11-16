// The live edit channel (WebSocket /api/ws): edits and view changes go out,
// frames and state come back. Reconnects by itself and detects a dead
// connection with a heartbeat.

import type { Region } from "./api.js";

export type Patch = Record<string, Record<string, unknown>>;
export type Params = Record<string, Record<string, unknown>>;

export interface ViewRequest {
    x: number;
    y: number;
    w: number;
    h: number;
    out_w: number;
}

export interface HistoryState {
    selected: number;
    count: number;
    can_undo: boolean;
    can_redo: boolean;
}

export interface FrameHeader {
    seq: number;
    region: Region;
    w: number;
    h: number;
    ms: number;
    history: HistoryState;
    dirty: boolean;
    /** the size of the image as shown: it changes with a quarter turn */
    size: { full_width: number; full_height: number };
}

export interface StateMessage {
    seq: number;
    params: Params;
    history: HistoryState;
    dirty: boolean;
    size: { full_width: number; full_height: number };
}

export interface LiveEvents {
    open(): void;
    close(reason: string): void;
    frame(h: FrameHeader, jpeg: Blob): void;
    state(s: StateMessage): void;
    error(message: string, seq: number): void;
    /** the engine is busy (an export) or free again */
    busy(what: string | null): void;
}

const HEARTBEAT_MS = 5000;

export class Live {
    private ws: WebSocket | null = null;
    private seq = 0;
    private retry = 0;
    private timer = 0;
    private beat = 0;
    private lastPong = 0;
    private stopped = false;
    private ev: LiveEvents;

    constructor(ev: LiveEvents) {
        this.ev = ev;
    }

    get connected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    connect(): void {
        this.stopped = false;
        window.clearTimeout(this.timer);
        const url = new URL("/api/ws", location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        this.ws = ws;
        ws.onopen = () => {
            this.retry = 0;
            this.lastPong = performance.now();
            window.clearInterval(this.beat);
            this.beat = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
            this.ev.open();
        };
        ws.onmessage = (e) => this.message(e);
        ws.onclose = (e) => {
            if (this.ws !== ws) return;
            this.ws = null;
            window.clearInterval(this.beat);
            this.ev.close(e.reason || "connection closed");
            if (!this.stopped && e.reason !== "replaced by a newer connection") this.scheduleReconnect();
        };
        ws.onerror = () => {
            /* onclose follows */
        };
    }

    private scheduleReconnect(): void {
        const delay = Math.min(5000, 500 * 2 ** this.retry++);
        this.timer = window.setTimeout(() => this.connect(), delay);
    }

    private heartbeat(): void {
        if (performance.now() - this.lastPong > 2.5 * HEARTBEAT_MS) {
            this.ws?.close();
            return;
        }
        this.send({ type: "ping" });
    }

    private message(e: MessageEvent): void {
        if (typeof e.data === "string") {
            const m = JSON.parse(e.data);
            switch (m.type) {
                case "pong":
                    this.lastPong = performance.now();
                    break;
                case "state":
                    this.ev.state(m as StateMessage);
                    break;
                case "busy":
                    this.ev.busy(typeof m.what === "string" ? m.what : null);
                    break;
                case "error":
                    this.ev.error(String(m.message), Number(m.seq));
                    break;
                case "replaced":
                    this.stopped = true;
                    break;
            }
            return;
        }
        const buf = e.data as ArrayBuffer;
        const n = new DataView(buf).getUint32(0);
        const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as FrameHeader;
        this.lastPong = performance.now();
        this.ev.frame(header, new Blob([new Uint8Array(buf, 4 + n)], { type: "image/jpeg" }));
    }

    private send(m: Record<string, unknown>): number {
        const seq = ++this.seq;
        if (this.connected) this.ws!.send(JSON.stringify({ ...m, seq }));
        return seq;
    }

    /** Apply a patch; steps of one gesture share `merge` and make one undo step. */
    edit(patch: Patch, view: ViewRequest, merge?: string): number {
        return this.send({ type: "edit", patch, view, ...(merge ? { merge } : {}) });
    }
    view(view: ViewRequest): number {
        return this.send({ type: "view", view });
    }
    undo(view: ViewRequest): number {
        return this.send({ type: "undo", view });
    }
    redo(view: ViewRequest): number {
        return this.send({ type: "redo", view });
    }
    /** Apply a saved profile (an id from the profile list); the answer is a state and a frame. */
    profile(id: string, append: boolean, view: ViewRequest): number {
        return this.send({ type: "profile", id, append, view });
    }
    /** Ask for the full state and a frame (after connecting or opening an image). */
    sync(view: ViewRequest): number {
        return this.send({ type: "sync", view });
    }
}
