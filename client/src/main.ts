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

// MART: the editor screen.

import {
    ApiError,
    NetworkError,
    getInfo,
    getStatus,
    openImage,
    saveImage,
    spotWB,
} from "./api.js";
import type { ImageInfo } from "./api.js";
import "./clutpanel.js"; // these register their panels with controls.ts
import "./other.js";
import { attachRetouch, mergeRetouch, setRetouchActive } from "./retouch.js";
import { makeControl } from "./controls.js";
import type { Control, ControlHost } from "./controls.js";
import { CropOverlay, clampRect, fitRatio } from "./crop.js";
import type { Rect } from "./crop.js";
import {
    buildCropTab,
    cropFromParams,
    cropPatch,
    ratioFor,
} from "./croptool.js";
import type { RatioKey } from "./croptool.js";
import { showExport } from "./exportsheet.js";
import { showInfo } from "./info.js";
import { Live } from "./live.js";
import type {
    FrameHeader,
    HistoryState,
    Params,
    Patch,
    StateMessage,
} from "./live.js";
import { showLooks } from "./looks.js";
import { isNative } from "./native.js";
import { openExternal, showOpen } from "./opener.js";
import { el, openSheet } from "./sheet.js";
import { PreviewView } from "./preview.js";
import { FrameThrottle, mergePatch } from "./throttle.js";
import { TOOLS, patchFor } from "./tools.js";
import type { ControlDef } from "./tools.js";

const $ = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T;

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

const profilesBtn = $<HTMLButtonElement>("profiles");
const exportBtn = $<HTMLButtonElement>("export");
const infoBtn = $<HTMLButtonElement>("info");
const openBtn = $<HTMLButtonElement>("open");

let params: Params = {};
let fileName = "";
let dragging = false; // a slider is being dragged: render half-size frames
// size of the image as `preview` shows it (changes with a quarter turn)
let imgW = 0;
let imgH = 0;
let activeTool = "";
let picking = false; // the next tap on the image sets the white balance
// "exporting": the engine is busy, edits wait
let busyWhat: string | null = null;

// ---- small helpers ---------------------------------------------------------

function showOverlay(heading: string, text: string, form = false): void {
    ovTitle.textContent = heading;
    ovText.textContent = text;
    ovForm.hidden = !form;
    overlay.hidden = false;
    if (form && !isNative()) ovPath.focus();
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
    title.textContent =
        (fileName || "MART") + (busyWhat ? " \u00b7 exporting\u2026" : "");
}

/**
 * the engine is busy with an export: the tools are disabled until it is done
 */
function setBusy(what: string | null): void {
    busyWhat = what;
    document.body.classList.toggle("busy", what !== null);
    setTitle();
}

// ---- live channel, preview -------------------------------------------------

let frameChain: Promise<void> = Promise.resolve();

let wasConnected = false;

const live = new Live({
    open: () => {
        wasConnected = true;
        void start();
    },
    close: (reason) => {
        conn.className = "dot bad";
        if (wasConnected)
            showOverlay(
                "Connection lost",
                `Trying to reconnect to the MART server… (${reason})`,
            );
        else
            showOverlay(
                "Cannot reach the MART server",
                "Is it running, and is this device on the same network? " +
                    "Trying again…",
            );
    },
    frame: (h: FrameHeader, jpeg: Blob) => {
        // decode in order, so that an older frame never replaces a newer one
        frameChain = frameChain.then(async () => {
            const bmp = await createImageBitmap(jpeg);
            const turned =
                h.size.full_width !== imgW || h.size.full_height !== imgH;
            applySize(h.size.full_width, h.size.full_height);
            preview.setFrame(bmp, h.region);
            setHistory(h.history, h.dirty);
            if (turned) {
                // the frame shows the whole image: ask for the view the user
                // now has
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
    busy: (what) => setBusy(what),
    rendering: (on) => conn.classList.toggle("wait", on),
});

const preview = new PreviewView($("view") as HTMLCanvasElement, () => {
    const v = preview.request(false);
    if (v) live.view(v);
});

const throttle = new FrameThrottle((patch, key) => {
    const v = preview.request(key !== "" && dragging);
    if (v) live.edit(patch, v, key || undefined);
});

// ---- applying patches from the tools ----------------------------------------

/** a discrete change (a button, a tap): applied at once */
function applyPatch(patch: Patch): void {
    mergePatch(params, patch);
    throttle.push(patch, "");
    throttle.flush();
    syncControls();
}

// ---- crop -------------------------------------------------------------------

const cropOverlay = new CropOverlay(
    $("crop") as HTMLCanvasElement,
    preview,
    $("view"),
    (rect) => setCrop(rect, cropState().ratio),
);
preview.afterDraw = () => cropOverlay.draw();
cropOverlay.onVignette = (x, y) => {
    // placing the center switches the filter on, as moving a slider does
    applyPatch({ PCVignette: { Enabled: true, CenterX: x, CenterY: y } });
};

/** the vignette center in the overlay, when the filter is on */
function syncVignette(): void {
    const v = params["PCVignette"];
    const n = (k: string): number =>
        typeof v?.[k] === "number" ? (v[k] as number) : 0;
    cropOverlay.setVignette(
        v?.["Enabled"] === true ? { x: n("CenterX"), y: n("CenterY") } : null,
    );
}
attachRetouch(preview, () => ({ w: imgW, h: imgH }));

const cropState = () => cropFromParams(params, imgW, imgH);

/**
 * show the crop rectangle in the overlay; outside the Crop tab the view shows
 * only the cropped part
 */
function syncCrop(): void {
    if (!imgW) return;
    const c = cropState();
    cropOverlay.setRect(c.rect);
    cropOverlay.setRatio(
        c.ratio ? ratioFor(c.ratio, imgW, imgH, c.portrait) : null,
    );
    cropTab.sync(c);
    syncVignette();
    preview.setBounds(activeTool !== "crop" && c.enabled ? c.rect : null, {
        w: imgW,
        h: imgH,
    });
}

function setCrop(rect: Rect, ratio: RatioKey | null): void {
    applyPatch(cropPatch(rect, ratio));
    syncCrop();
}

const cropTab = buildCropTab({
    turn(deg) {
        const rot =
            (((Number(params["Coarse Transformation"]?.["Rotate"] ?? 0) + deg) %
                360) +
                360) %
            360;
        // the rectangle means nothing in the turned image: start again
        applyPatch({
            "Coarse Transformation": { Rotate: rot },
            Crop: { Enabled: false },
        });
    },
    flip(axis) {
        const key = axis === "h" ? "HorizontalFlip" : "VerticalFlip";
        applyPatch({
            "Coarse Transformation": {
                [key]: params["Coarse Transformation"]?.[key] !== true,
            },
            Crop: { Enabled: false },
        });
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
        const turned = clampRect(
            {
                x: cx - c.rect.h / 2,
                y: cy - c.rect.w / 2,
                w: c.rect.h,
                h: c.rect.w,
            },
            imgW,
            imgH,
        );
        setCrop(
            fitRatio(turned, ratioFor(c.ratio, imgW, imgH, portrait)),
            c.ratio,
        );
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
        if (def.kind === "heading" || def.kind === "custom") return;
        const patch = patchFor(def, value, (g, k) => params[g]?.[k]);
        mergePatch(params, patch); // so that the next control sees it
        if (gesture) dragging = true;
        throttle.push(patch, gesture ? `${def.key}#${gesture}` : "");
        if (!gesture) throttle.flush();
        // a Temperature/Tint change also switches the preset chips, and a mode
        // shows other controls
        if (def.group === "White Balance" || !gesture) syncControls();
    },
    raw(patch, gestureKey) {
        // the retouch regions: the patch is {Retouch: {id: fields | null}};
        // keep our copy of them as the host will have them
        if (patch["Retouch"]) mergeRetouch(params, patch["Retouch"]);
        if (gestureKey) dragging = true;
        throttle.push(patch, gestureKey);
        if (!gestureKey) {
            throttle.flush();
            syncControls();
        }
    },
    gestureEnd() {
        throttle.flush();
        dragging = false;
        // a drag can switch its tool on: show the "Enabled" switch as it is
        syncControls();
        const v = preview.request(false); // the full quality frame
        if (v) live.view(v);
    },
};

function syncControls(): void {
    for (const c of controls) c.sync(params);
    syncVignette();
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
        const clamp = (v: number, lo: number, hi: number): number =>
            Math.min(Math.max(v, lo), hi);
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

/** the icons of the tabs (24x24, drawn with the text colour) */
const TAB_ICONS: Record<string, string> = {
    tone:
        '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 ' +
        '0-17z" fill="currentColor"/>',
    color:
        '<path d="M12 3.5C8 8.5 5.5 11.5 5.5 15a6.5 6.5 0 0 0 13 ' +
        '0c0-3.5-2.5-6.5-6.5-11.5z"/>',
    detail:
        '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle ' +
        'cx="12" cy="12" r="2.5"/>',
    retouch:
        '<path d="M18.5 3.5a2 2 0 0 1 2 2c0 1-4.5 6-7 8.5l-3-3c2.5-2.5 ' +
        '7.5-7.5 8-7.5z"/><path d="M10.5 11.5l3 3c-.5 3-3 5-7 5 1.5-1.5 1-3 ' +
        '1.5-4.5.5-1.5 1.5-2.5 2.5-3.5z"/>',
    crop: '<path d="M7 2v15h15M2 7h15v15"/>',
    other:
        '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle ' +
        'cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" ' +
        'cy="12" r="1.6" fill="currentColor"/>',
};

function buildPanel(): void {
    const tabs = $("tabs");
    const tools = $("tools");
    const sections: HTMLElement[] = [];
    const tabButtons: HTMLButtonElement[] = [];
    const panel = $("panel");
    // phone layout: the tools float over the picture and fold away (a tap on
    // the picture, or on the open tab)
    const setOpen = (open: boolean): void => {
        panel.classList.toggle("collapsed", !open);
        store("mart.open", open ? "1" : "0");
    };
    setOpen(store("mart.open") !== "0");
    preview.onAnyTap = () => setOpen(false);
    const activate = (i: number): void => {
        sections.forEach((s, j) => (s.hidden = j !== i));
        tabButtons.forEach((b, j) =>
            b.setAttribute("aria-selected", String(j === i)),
        );
        store("mart.tab", String(i));
        activeTool = TOOLS[i]!.id;
        cropOverlay.setActive(activeTool === "crop");
        setRetouchActive(activeTool === "retouch");
        setPicking(false);
        syncCrop();
    };
    TOOLS.forEach((tool, i) => {
        const b = document.createElement("button");
        b.type = "button";
        // an icon; the name stays for screen readers (and as the tooltip)
        b.innerHTML =
            `<svg class="tab-icon" viewBox="0 0 24 24" ` +
            `aria-hidden="true">${TAB_ICONS[tool.id] ?? ""}</svg>`;
        const name = document.createElement("span");
        name.className = "sr-only";
        name.textContent = tool.label;
        b.append(name);
        b.title = tool.label;
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => {
            const same =
                tabButtons[i]!.getAttribute("aria-selected") === "true";
            setOpen(!(same && !panel.classList.contains("collapsed")));
            activate(i);
        });
        tabs.appendChild(b);
        tabButtons.push(b);
        const sec = document.createElement("section");
        sec.setAttribute("role", "tabpanel");
        if (tool.id === "crop") sec.appendChild(cropTab.el);
        // each heading starts a collapsible group; one group of a tab is open
        // at a time
        const groups: { group: HTMLElement; toggle: HTMLButtonElement }[] = [];
        let body: HTMLElement | null = null;
        for (const def of tool.controls) {
            const c = makeControl(def, host);
            controls.push(c);
            if (def.kind === "heading") {
                const group = document.createElement("div");
                group.className = "tool-group";
                body = document.createElement("div");
                body.className = "tool-body";
                group.append(c.el, body);
                sec.appendChild(group);
                groups.push({ group, toggle: c.el.querySelector("button")! });
            } else (body ?? sec).appendChild(c.el);
        }
        // the picker belongs to the white balance group, the first of the Color
        // tab
        if (tool.id === "color")
            groups[0]!.group.querySelector(".tool-body")!.prepend(pickButton());
        if (groups.length) {
            const open = (n: number): void => {
                groups.forEach((g, k) => {
                    g.group.classList.toggle("open", k === n);
                    g.toggle.setAttribute("aria-expanded", String(k === n));
                });
                store("mart.group." + tool.id, String(n));
            };
            groups.forEach((g, k) =>
                g.toggle.addEventListener("click", () =>
                    open(g.group.classList.contains("open") ? -1 : k),
                ),
            );
            const savedGroup = Number(store("mart.group." + tool.id) ?? 0);
            open(
                Number.isInteger(savedGroup) && savedGroup < groups.length
                    ? savedGroup
                    : 0,
            );
        }
        tools.appendChild(sec);
        sections.push(sec);
    });
    const saved = Number(store("mart.tab"));
    activate(
        Number.isInteger(saved) && saved >= 0 && saved < TOOLS.length
            ? saved
            : 0,
    );
}

// ---- image and connection --------------------------------------------------

function show(info: ImageInfo): void {
    fileName = info.file.split("/").pop() ?? info.file;
    setTitle();
    hideOverlay();
    // a new image: start from scratch even if it has the same size
    imgW = imgH = 0;
    params = {};
    applySize(info.full_width, info.full_height);
    const v = preview.request(false);
    if (v) live.sync(v);
}

function onError(e: unknown): void {
    if (e instanceof ApiError && e.status === 401) {
        showOverlay(
            "Access token needed",
            "Open the address printed by the server, which ends in ?token=…",
        );
    } else if (e instanceof NetworkError) {
        conn.className = "dot bad";
        showOverlay(
            "Cannot reach the MART server",
            "Is it running, and is this device on the same network? " +
                e.message,
        );
    } else {
        showOverlay(
            "Something went wrong",
            e instanceof Error ? e.message : String(e),
        );
    }
}

/** (Re)connected: find out what the server has open. */
// resolved when the page knows what is open (the first start() is done): an image that the app
// hands over (a file manager's "open with" / "send to") waits for it
let pageReady: () => void = () => undefined;
const whenReady = new Promise<void>((resolve) => {
    pageReady = resolve;
});

async function start(): Promise<void> {
    try {
        const st = await getStatus();
        conn.className = "dot ok";
        setBusy(st.busy);
        if (st.open) show(await getInfo());
        else {
            showOverlay(
                "Open an image",
                isNative()
                    ? "Choose an image from a folder on this device."
                    : "Type the path of a raw file on the machine running MART.",
                true,
            );
        }
    } catch (e) {
        onError(e);
    } finally {
        pageReady();
    }
}

if (isNative()) {
    // in the app the image is chosen from a folder, not typed
    ovPath.hidden = true;
    ovForm.querySelector("button")!.textContent = "Open…";
}

ovForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (isNative()) {
        showOpen({ save, opened: show });
        return;
    }
    try {
        const path = ovPath.value.trim();
        if (!path) return;
        ovText.textContent = "Opening…";
        show(await openImage(path));
    } catch (e) {
        if (e instanceof ApiError && e.status !== 401 && e.status !== 503)
            ovText.textContent = e.message;
        else if (e instanceof ApiError || e instanceof NetworkError) onError(e);
        else ovText.textContent = e instanceof Error ? e.message : String(e);
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
saveBtn.addEventListener(
    "click",
    () =>
        void save().catch((e) =>
            toast(e instanceof Error ? e.message : String(e)),
        ),
);

profilesBtn.addEventListener("click", () => {
    void showLooks({
        apply(id, name, append) {
            throttle.flush();
            const v = preview.request(false);
            if (v) {
                live.profile(id, append, v);
                toast(`Applied ${name}`);
            }
        },
        saved(name) {
            toast(`Saved the profile ${name}`);
        },
        imported(name) {
            toast(`Imported the profile ${name}`);
        },
    });
});
exportBtn.addEventListener("click", () =>
    showExport(fileName.replace(/\.[^.]*$/, "")),
);
infoBtn.addEventListener("click", async () => {
    try {
        showInfo(await getInfo());
    } catch (e) {
        onError(e);
    }
});
openBtn.addEventListener("click", () => showOpen({ save, opened: show }));
// the app hands over an image (window event "mart-open", detail: {path})
window.addEventListener("mart-open", (ev) => {
    const path = (ev as CustomEvent<{ path?: string }>).detail?.path;
    if (!path) return;
    void whenReady.then(() =>
        openExternal({ save, opened: show }, path),
    );
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

// for the browser tests (host/tests/ui_m3.mjs): where an image point is on the
// page, and the editor's state
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

// Keep the application for offline start-up. Only where the browser allows it:
// a secure context (https, or localhost). Not in the apps: the host is in the app, and its port
// changes at each start (each one would get its own copy of the files).
if ("serviceWorker" in navigator && !isNative()) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
        /*
         * not allowed here (plain http on a network): the app just works
         * without being installable
         */
    });
}
