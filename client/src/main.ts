// MART: the editor screen.

import { ApiError, NetworkError, getInfo, getStatus, openImage, saveImage, spotWB } from "./api.js";
import type { ImageInfo } from "./api.js";
import { makeControl } from "./controls.js";
import type { Control, ControlHost } from "./controls.js";
import { CropOverlay, clampRect, fitRatio } from "./crop.js";
import type { Rect } from "./crop.js";
import { buildCropTab, cropFromParams, cropPatch, ratioFor } from "./croptool.js";
import type { RatioKey } from "./croptool.js";
import { showInfo } from "./info.js";
import { Live } from "./live.js";
import type { FrameHeader, HistoryState, Params, Patch, StateMessage } from "./live.js";
import { showLooks } from "./looks.js";
import { showOpen } from "./opener.js";
import { PreviewView } from "./preview.js";
import { FrameThrottle, mergePatch } from "./throttle.js";
import { TOOLS, patchFor } from "./tools.js";
import type { ControlDef } from "./tools.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const title = $("title");
const conn = $("conn");
const overlay = $("overlay");
const ovTitle = $("ov-title");
const ovText = $("ov-text");
const ovForm = $<HTMLFormElement>("ov-form");
const ovPath = $<HTMLInputElement>("ov-path");
const undoBtn = $<HTMLButtonElement>("undo");
const redoBtn = $<HTMLButtonElement>("redo");
const saveBtn = $<HTMLButtonElement>("save");
const toastEl = $("toast");

const lookBtn = $<HTMLButtonElement>("look");
const infoBtn = $<HTMLButtonElement>("info");

let params: Params = {};
let fileName = "";
let dragging = false; // a slider is being dragged: render half-size frames
let imgW = 0; // size of the image as `preview` shows it (changes with a quarter turn)
let imgH = 0;
let activeTool = "";
let picking = false; // the next tap on the image sets the white balance

// ---- small helpers ---------------------------------------------------------

function showOverlay(heading: string, text: string, form = false): void {
    ovTitle.textContent = heading;
    ovText.textContent = text;
    ovForm.hidden = !form;
    overlay.hidden = false;
    if (form) ovPath.focus();
}
const hideOverlay = (): void => {
    overlay.hidden = true;
};

let toastTimer = 0;
function toast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4000);
}

function store(key: string, value?: string): string | null {
    try {
        if (value !== undefined) localStorage.setItem(key, value);
        return localStorage.getItem(key);
    } catch {
        return null; // private mode, blocked storage
    }
}

function setHistory(h: HistoryState, dirty: boolean): void {
    undoBtn.disabled = !h.can_undo;
    redoBtn.disabled = !h.can_redo;
    saveBtn.disabled = !dirty;
    title.classList.toggle("dirty", dirty);
}

/** the image has this size: new image, or a quarter turn */
function applySize(w: number, h: number): void {
    if (w === imgW && h === imgH) return;
    imgW = w;
    imgH = h;
    preview.setImage(w, h);
    cropOverlay.setImageSize(w, h);
    syncCrop();
}

function setTitle(): void {
    title.textContent = fileName || "MART";
}

// ---- live channel, preview -------------------------------------------------

let frameChain: Promise<void> = Promise.resolve();

const live = new Live({
    open: () => void start(),
    close: (reason) => {
        conn.className = "dot bad";
        showOverlay("Connection lost", `Trying to reconnect to the MART server… (${reason})`);
    },
    frame: (h: FrameHeader, jpeg: Blob) => {
        // decode in order, so that an older frame never replaces a newer one
        frameChain = frameChain.then(async () => {
            const bmp = await createImageBitmap(jpeg);
            const turned = h.size.full_width !== imgW || h.size.full_height !== imgH;
            applySize(h.size.full_width, h.size.full_height);
            preview.setFrame(bmp, h.region);
            setHistory(h.history, h.dirty);
            if (turned) {
                // the frame shows the whole image: ask for the view the user now has
                const v = preview.request(false);
                if (v) live.view(v);
            }
        });
    },
    state: (s: StateMessage) => {
        params = s.params;
        applySize(s.size.full_width, s.size.full_height);
        syncControls();
        syncCrop();
        setHistory(s.history, s.dirty);
    },
    error: (message) => toast(message),
});

const preview = new PreviewView($("view") as HTMLCanvasElement, () => {
    const v = preview.request(false);
    if (v) live.view(v);
});

const throttle = new FrameThrottle((patch, key) => {
    const v = preview.request(key !== "" && dragging);
    if (v) live.edit(patch, v, key || undefined);
});

// ---- applying patches from the tools --------------------------------------------

/** a discrete change (a button, a tap): applied at once */
function applyPatch(patch: Patch): void {
    mergePatch(params, patch);
    throttle.push(patch, "");
    throttle.flush();
    syncControls();
}

// ---- crop ------------------------------------------------------------------------

const cropOverlay = new CropOverlay($("crop") as HTMLCanvasElement, preview, $("view"), (rect) => setCrop(rect, cropState().ratio));
preview.afterDraw = () => cropOverlay.draw();

const cropState = () => cropFromParams(params, imgW, imgH);

/** show the crop rectangle in the overlay; outside the Crop tab the view shows only the cropped part */
function syncCrop(): void {
    if (!imgW) return;
    const c = cropState();
    cropOverlay.setRect(c.rect);
    cropOverlay.setRatio(c.ratio ? ratioFor(c.ratio, imgW, imgH, c.portrait) : null);
    cropTab.sync(c);
    preview.setBounds(activeTool !== "crop" && c.enabled ? c.rect : null, { w: imgW, h: imgH });
}

function setCrop(rect: Rect, ratio: RatioKey | null): void {
    applyPatch(cropPatch(rect, ratio));
    syncCrop();
}

const cropTab = buildCropTab({
    turn(deg) {
        const rot = (((Number(params["Coarse Transformation"]?.["Rotate"] ?? 0) + deg) % 360) + 360) % 360;
        // the rectangle means nothing in the turned image: start again
        applyPatch({ "Coarse Transformation": { Rotate: rot }, Crop: { Enabled: false } });
    },
    flip(axis) {
        const key = axis === "h" ? "HorizontalFlip" : "VerticalFlip";
        applyPatch({ "Coarse Transformation": { [key]: params["Coarse Transformation"]?.[key] !== true }, Crop: { Enabled: false } });
    },
    pickRatio(key) {
        const c = cropState();
        if (!key) {
            applyPatch({ Crop: { FixedRatio: false } });
            syncCrop();
            return;
        }
        setCrop(fitRatio(c.rect, ratioFor(key, imgW, imgH, c.portrait)), key);
    },
    swap() {
        const c = cropState();
        if (!c.ratio) return;
        const portrait = !(c.rect.h > c.rect.w);
        const cx = c.rect.x + c.rect.w / 2;
        const cy = c.rect.y + c.rect.h / 2;
        const turned = clampRect({ x: cx - c.rect.h / 2, y: cy - c.rect.w / 2, w: c.rect.h, h: c.rect.w }, imgW, imgH);
        setCrop(fitRatio(turned, ratioFor(c.ratio, imgW, imgH, portrait)), c.ratio);
    },
    reset() {
        applyPatch({ Crop: { Enabled: false } });
        syncCrop();
    },
});

// ---- controls --------------------------------------------------------------

const controls: Control[] = [];

const host: ControlHost = {
    set(def: ControlDef, value: unknown, gesture: number) {
        const patch = patchFor(def, value, (g, k) => params[g]?.[k]);
        mergePatch(params, patch); // so that the next control sees it
        if (gesture) dragging = true;
        throttle.push(patch, gesture ? `${def.key}#${gesture}` : "");
        if (!gesture) throttle.flush();
        // a Temperature/Tint change also switches the preset chips
        if (def.group === "White Balance") syncControls();
    },
    gestureEnd() {
        throttle.flush();
        dragging = false;
        const v = preview.request(false); // the full quality frame
        if (v) live.view(v);
    },
};

function syncControls(): void {
    for (const c of controls) c.sync(params);
}

let pickBtn: HTMLButtonElement | null = null;

function pickButton(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ctl";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip wide";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", "false");
    b.textContent = "Pick a neutral gray on the image";
    b.addEventListener("click", () => setPicking(!picking));
    pickBtn = b;
    wrap.appendChild(b);
    return wrap;
}

function setPicking(on: boolean): void {
    picking = on;
    pickBtn?.setAttribute("aria-checked", String(on));
    preview.onTap = on ? (x, y) => void pickWhite(x, y) : null;
    if (on) toast("Tap something that should be neutral gray or white");
}

async function pickWhite(x: number, y: number): Promise<void> {
    setPicking(false);
    const r = 10; // a 21 x 21 pixel square around the tap
    const bx = Math.min(Math.max(Math.round(x) - r, 0), imgW - 2 * r - 1);
    const by = Math.min(Math.max(Math.round(y) - r, 0), imgH - 2 * r - 1);
    try {
        const wb = await spotWB(bx, by, 2 * r + 1, 2 * r + 1);
        const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
        applyPatch({
            "White Balance": {
                Enabled: true,
                Setting: "CustomTemp",
                Temperature: Math.round(clamp(wb.temperature, 1500, 60000)),
                Green: clamp(wb.tint, 0.02, 10),
            },
        });
    } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
    }
}

function buildPanel(): void {
    const tabs = $("tabs");
    const tools = $("tools");
    const sections: HTMLElement[] = [];
    const tabButtons: HTMLButtonElement[] = [];
    const activate = (i: number): void => {
        sections.forEach((s, j) => (s.hidden = j !== i));
        tabButtons.forEach((b, j) => b.setAttribute("aria-selected", String(j === i)));
        store("mart.tab", String(i));
        activeTool = TOOLS[i]!.id;
        cropOverlay.setActive(activeTool === "crop");
        setPicking(false);
        syncCrop();
    };
    TOOLS.forEach((tool, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = tool.label;
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => activate(i));
        tabs.appendChild(b);
        tabButtons.push(b);
        const sec = document.createElement("section");
        sec.setAttribute("role", "tabpanel");
        if (tool.id === "crop") sec.appendChild(cropTab.el);
        if (tool.id === "color") sec.appendChild(pickButton());
        for (const def of tool.controls) {
            const c = makeControl(def, host);
            controls.push(c);
            sec.appendChild(c.el);
        }
        tools.appendChild(sec);
        sections.push(sec);
    });
    const saved = Number(store("mart.tab"));
    activate(Number.isInteger(saved) && saved >= 0 && saved < TOOLS.length ? saved : 0);
}

// ---- image and connection --------------------------------------------------

function show(info: ImageInfo): void {
    fileName = info.file.split("/").pop() ?? info.file;
    setTitle();
    hideOverlay();
    imgW = imgH = 0; // a new image: start from scratch even if it has the same size
    params = {};
    applySize(info.full_width, info.full_height);
    const v = preview.request(false);
    if (v) live.sync(v);
}

function onError(e: unknown): void {
    if (e instanceof ApiError && e.status === 401) {
        showOverlay("Access token needed", "Open the address printed by the server, which ends in ?token=…");
    } else if (e instanceof NetworkError) {
        conn.className = "dot bad";
        showOverlay("Cannot reach the MART server", "Is it running, and is this device on the same network? " + e.message);
    } else {
        showOverlay("Something went wrong", e instanceof Error ? e.message : String(e));
    }
}

/** (Re)connected: find out what the server has open. */
async function start(): Promise<void> {
    try {
        const st = await getStatus();
        conn.className = "dot ok";
        if (st.open) show(await getInfo());
        else {
            showOverlay("Open an image", "Type the path of a raw file on the machine running MART.", true);
        }
    } catch (e) {
        onError(e);
    }
}

ovForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const path = ovPath.value.trim();
    if (!path) return;
    ovText.textContent = "Opening…";
    try {
        show(await openImage(path));
    } catch (e) {
        if (e instanceof ApiError && e.status !== 401 && e.status !== 503) ovText.textContent = e.message;
        else onError(e);
    }
});

undoBtn.addEventListener("click", () => {
    throttle.flush();
    const v = preview.request(false);
    if (v) live.undo(v);
});
redoBtn.addEventListener("click", () => {
    throttle.flush();
    const v = preview.request(false);
    if (v) live.redo(v);
});
async function save(): Promise<void> {
    throttle.flush();
    const r = await saveImage();
    saveBtn.disabled = true;
    title.classList.remove("dirty");
    toast("Saved " + r.file.split("/").pop());
}
saveBtn.addEventListener("click", () => void save().catch((e) => toast(e instanceof Error ? e.message : String(e))));

lookBtn.addEventListener("click", () => {
    void showLooks({
        apply(id, name, append) {
            throttle.flush();
            const v = preview.request(false);
            if (v) {
                live.profile(id, append, v);
                toast(`Applied ${name}`);
            }
        },
    });
});
infoBtn.addEventListener("click", async () => {
    try {
        showInfo(await getInfo(), () => showOpen({ save, opened: show }));
    } catch (e) {
        onError(e);
    }
});
document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        (e.shiftKey ? redoBtn : undoBtn).click();
    }
});

buildPanel();
setTitle();
live.connect();

// for the browser tests (host/tests/ui_m3.mjs): where an image point is on the page, and the editor's state
(window as unknown as { __mart: unknown }).__mart = {
    toPage(x: number, y: number) {
        const p = preview.toScreen(x, y);
        const r = $("view").getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
    },
    params: () => params,
    size: () => ({ w: imgW, h: imgH }),
    bounds: () => preview.getBounds(),
    layout: () => preview.layout(),
};
