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

// Open another image: by its path on the machine running MART; in the app, from a
// list of the images of a folder chosen on the device (they are opened in place). Unsaved edits
// are never dropped silently.

import {
    ApiError,
    browseFolder,
    getStatus,
    listImages,
    openImage,
    thumbnailUrl,
} from "./api.js";
import type { FolderListing, ImageEntry, ImageInfo } from "./api.js";
import { formatBytes } from "./exportsheet.js";
import {
    isNative,
    nativeCapabilities,
    nativeFolders,
    nativeImportPhotos,
    nativePickFolder,
    nativeRequestAccess,
} from "./native.js";
import type { NativeFolder } from "./native.js";
import { el, openSheet } from "./sheet.js";

export interface OpenHost {
    /** save the current image (rejects on failure) */
    save(): Promise<void>;
    opened(info: ImageInfo): void;
}

const FOLDER_KEY = "mart.folder";

export function showOpen(host: OpenHost): void {
    const sheet = openSheet("Open an image");
    const native = isNative();
    const text = el("p", {
        class: "muted",
        text: native
            ? "Choose an image from a folder on this device."
            : "Choose an image from the folders of the machine running MART, or type the path of a file or of a folder.",
    });
    const input = el("input", {
        type: "text",
        placeholder: "/path/to/photo.arw",
    });
    input.setAttribute("aria-label", "Path of the image on the server");
    input.autocapitalize = "off";
    input.spellcheck = false;
    const go = el("button", { class: "action", text: "Open" });
    const choice = el("div", { class: "choice" });

    const doOpen = makeDoOpen(host, sheet, text, choice);

    if (native) {
        void showFolders(sheet.body, text, choice, (p) => doOpen(p, false));
        return;
    }
    const browser = serverBrowser(text, input, (p) => doOpen(p, false));
    sheet.body.append(text, input, go, browser.el, choice);
    input.focus();
    // a folder is browsed, anything else is a file to open
    const submit = async (): Promise<void> => {
        const v = input.value.trim();
        if (!v) return;
        try {
            browser.show(await browseFolder(v));
        } catch (e) {
            if (e instanceof ApiError && e.status === 404) void doOpen(v, false);
            else text.textContent = e instanceof Error ? e.message : String(e);
        }
    };
    go.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
    });
    void browser.start();
}

/** open an image from the sheet; the choice for unsaved edits is shown in `choice` */
function makeDoOpen(
    host: OpenHost,
    sheet: { close(): void },
    text: HTMLElement,
    choice: HTMLElement,
): (path: string, discard: boolean) => Promise<void> {
    const doOpen = async (path: string, discard: boolean): Promise<void> => {
        choice.replaceChildren();
        try {
            const info = await openImage(path, discard);
            sheet.close();
            host.opened(info);
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
                const saveOpen = el("button", {
                    class: "action",
                    text: "Save, then open",
                });
                const discardOpen = el("button", {
                    class: "action danger",
                    text: "Discard the edits and open",
                });
                saveOpen.addEventListener("click", async () => {
                    try {
                        await host.save();
                        await doOpen(path, false);
                    } catch (err) {
                        text.textContent =
                            err instanceof Error ? err.message : String(err);
                    }
                });
                discardOpen.addEventListener("click", () =>
                    void doOpen(path, true),
                );
                choice.append(
                    el("p", {
                        text: "The current image has edits that are not saved.",
                    }),
                    saveOpen,
                    discardOpen,
                );
                choice.scrollIntoView({ block: "nearest" });
            } else {
                text.textContent = e instanceof Error ? e.message : String(e);
            }
        }
    };
    return doOpen;
}

/**
 * An image handed to the app from outside (a file manager's "open with" or "send to"): open it,
 * asking what to do with unsaved edits if there are any.
 */
export async function openExternal(host: OpenHost, path: string): Promise<void> {
    try {
        host.opened(await openImage(path, false));
        return;
    } catch {
        /* say why, in a sheet (also the choice for unsaved edits) */
    }
    const sheet = openSheet("Open an image");
    const text = el("p", { class: "muted", text: path.split("/").pop() ?? path });
    const choice = el("div", { class: "choice" });
    sheet.body.append(text, choice);
    await makeDoOpen(host, sheet, text, choice)(path, false);
}

function remembered(): string | null {
    try {
        return localStorage.getItem(FOLDER_KEY);
    } catch {
        return null;
    }
}

function remember(path: string): void {
    try {
        localStorage.setItem(FOLDER_KEY, path);
    } catch {
        /* private mode */
    }
}

/** the folder selector and the list of its images, in the app */
async function showFolders(
    body: HTMLElement,
    text: HTMLElement,
    choice: HTMLElement,
    open: (path: string) => Promise<void>,
): Promise<void> {
    const select = el("select", {});
    select.setAttribute("aria-label", "Folder");
    const choose = el("button", {
        class: "action secondary",
        text: "Choose another folder…",
    });
    const photos = el("button", {
        class: "action secondary",
        text: "Import from Photos…",
    });
    photos.hidden = true;
    const list = el("div", { class: "thumb-grid" });
    body.append(text, select, choose, photos, list, choice);

    let folders: NativeFolder[] = [];
    const fillSelect = (current: string): void => {
        select.replaceChildren(
            ...folders.map((f) => {
                const o = el("option", { text: f.name });
                o.value = f.path;
                o.selected = f.path === current;
                return o;
            }),
        );
    };
    const show = async (path: string): Promise<void> => {
        if (folders.find((f) => f.path === path)?.needsAccess) {
            // a folder of the device that the app may not read yet
            const allow = el("button", {
                class: "action",
                text: "Allow access…",
            });
            allow.addEventListener("click", () => {
                void nativeRequestAccess().catch(() => undefined);
            });
            const box = el("div", {});
            box.style.gridColumn = "1 / -1"; // the whole width of the grid
            box.append(
                el("p", {
                    class: "muted",
                    text:
                        "To open the pictures of this folder in place, next to their " +
                        "sidecars, MART needs access to all files. Allow it, then " +
                        "come back and choose the folder again.",
                }),
                allow,
            );
            list.replaceChildren(box);
            return;
        }
        list.replaceChildren(el("p", { class: "muted", text: "Reading…" }));
        let images: ImageEntry[];
        try {
            images = await listImages(path);
        } catch (e) {
            list.replaceChildren(
                el("p", {
                    class: "error",
                    text: e instanceof Error ? e.message : String(e),
                }),
            );
            return;
        }
        remember(path);
        if (images.length === 0) {
            list.replaceChildren(
                el("p", { class: "muted", text: "No images in this folder." }),
            );
            return;
        }
        fillImages(list, images, open);
    };

    try {
        folders = await nativeFolders();
    } catch (e) {
        text.textContent = e instanceof Error ? e.message : String(e);
        return;
    }
    const last = remembered();
    const start =
        folders.find((f) => f.path === last)?.path ?? folders[0]?.path ?? "";
    fillSelect(start);
    if (start) void show(start);
    select.addEventListener("change", () => void show(select.value));
    void nativeCapabilities().then((c) => {
        photos.hidden = !c.photos;
    });
    photos.addEventListener("click", async () => {
        try {
            const f = await nativeImportPhotos();
            if (!f) return;
            folders = [f, ...folders.filter((x) => x.path !== f.path)];
            fillSelect(f.path);
            await show(f.path);
        } catch (e) {
            text.textContent = e instanceof Error ? e.message : String(e);
        }
    });
    choose.addEventListener("click", async () => {
        try {
            const f = await nativePickFolder();
            if (!f) return;
            folders = [f, ...folders.filter((x) => x.path !== f.path)];
            fillSelect(f.path);
            await show(f.path);
        } catch (e) {
            text.textContent = e instanceof Error ? e.message : String(e);
        }
    });
}

/** the tiles of the images of a folder, with their thumbnails */
function fillImages(
    list: HTMLElement,
    images: ImageEntry[],
    open: (path: string) => Promise<void>,
): void {
    list.replaceChildren(
        ...images.map((im) => {
            const b = el("button", { class: "thumb-tile" });
            const pic = el("span", { class: "thumb-pic" });
            b.append(
                pic,
                el("span", {
                    class: "image-name",
                    text: im.name + (im.edited ? " \u25CF" : ""),
                }),
                el("span", { class: "muted", text: formatBytes(im.size) }),
            );
            b.addEventListener("click", () => {
                // stays marked while the sheet asks what to do with the
                // unsaved edits of the current image
                for (const t of list.querySelectorAll(".thumb-tile.selected")) {
                    t.classList.remove("selected");
                }
                b.classList.add("selected");
                void open(im.path);
            });
            lazyThumbnail(pic, im);
            return b;
        }),
    );
}

/**
 * The folders of the machine that runs the host, in a browser: the folder that is shown with its
 * subfolders (and "Up"), and the thumbnails of its images. The folders are the ones that the host
 * allows (the roots), so the first screen is their list, unless there is only one.
 */
function serverBrowser(
    text: HTMLElement,
    input: HTMLInputElement,
    open: (path: string) => Promise<void>,
): { el: HTMLElement; show(l: FolderListing): void; start(): Promise<void> } {
    const root = el("div", { class: "folder-browser" });
    const up = el("button", { class: "chip", text: "\u2191 Up" });
    const where = el("span", { class: "muted folder-where" });
    const bar = el("div", { class: "folder-bar" }, up, where);
    const subs = el("div", { class: "chips" });
    const grid = el("div", { class: "thumb-grid" });
    root.append(bar, subs, grid);
    let parent = "";
    const intro = text.textContent ?? "";

    const show = (l: FolderListing): void => {
        parent = l.parent;
        up.disabled = l.dir === "";
        where.textContent = l.dir === "" ? "Folders" : l.dir;
        if (l.dir !== "") input.value = l.dir;
        text.textContent = intro; // (an error of the last try is gone)
        subs.replaceChildren(
            ...l.dirs.map((d) => {
                const b = el("button", { class: "chip", text: d.name + (l.dir ? "/" : "") });
                b.addEventListener("click", () => void go(d.path));
                return b;
            }),
        );
        if (l.dir !== "") remember(l.dir);
        if (l.images.length > 0) fillImages(grid, l.images, open);
        else
            grid.replaceChildren(
                el("p", {
                    class: "muted",
                    text:
                        l.dir === ""
                            ? l.dirs.length === 0
                                ? "The host allows no folder: start it with --root DIR."
                                : ""
                            : "No images in this folder.",
                }),
            );
    };
    const go = async (dir: string, auto = false): Promise<boolean> => {
        try {
            const l = await browseFolder(dir);
            // one allowed folder only: start in it
            if (auto && l.dir === "" && l.dirs.length === 1) return go(l.dirs[0]!.path);
            show(l);
            return true;
        } catch (e) {
            text.textContent = e instanceof Error ? e.message : String(e);
            return false;
        }
    };
    up.addEventListener("click", () => void go(parent));
    return {
        el: root,
        show,
        async start() {
            // the folder of last time, the folder of the image that is open, the allowed folders
            const tries: string[] = [];
            const last = remembered();
            if (last) tries.push(last);
            try {
                const st = await getStatus();
                if (st.open) tries.push(st.open.file.slice(0, st.open.file.lastIndexOf("/")) || "/");
            } catch {
                /* the page says so elsewhere */
            }
            for (const t of tries) if (await go(t)) return;
            await go("", true);
        },
    };
}

// Thumbnails come from the host (libART's `thumbnail`), a few at a time as the tiles scroll
// into view; the browser keeps the ones seen.
const THUMB_SIZE = 256;
const queue: Array<() => Promise<void>> = [];
let running = 0;

function pump(): void {
    while (running < 3 && queue.length > 0) {
        const job = queue.shift()!;
        running++;
        void job().finally(() => {
            running--;
            pump();
        });
    }
}

/** show the thumbnail in the tile once it has loaded; resolves when it has (or failed) */
function loadPicture(pic: HTMLElement, url: string): Promise<void> {
    return new Promise((resolve) => {
        const img = el("img", {});
        img.alt = "";
        img.onload = () => {
            pic.replaceChildren(img);
            resolve();
        };
        img.onerror = () => resolve(); // keep the placeholder
        img.src = url;
    });
}

function lazyThumbnail(pic: HTMLElement, im: ImageEntry): void {
    const load = (): void => {
        queue.push(async () => {
            if (!pic.isConnected) return; // the list was replaced meanwhile
            await loadPicture(pic, thumbnailUrl(im, THUMB_SIZE));
        });
        pump();
    };
    const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            load();
        }
    });
    io.observe(pic);
}
