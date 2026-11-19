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

import { ApiError, listImages, openImage } from "./api.js";
import type { ImageEntry, ImageInfo } from "./api.js";
import { formatBytes } from "./exportsheet.js";
import {
    isNative,
    nativeFolders,
    nativePickFolder,
    nativeThumbnail,
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
            : "Type the path of a raw file on the machine running MART.",
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
            } else {
                text.textContent = e instanceof Error ? e.message : String(e);
            }
        }
    };

    if (native) {
        void showFolders(sheet.body, text, choice, (p) => doOpen(p, false));
        return;
    }
    sheet.body.append(text, input, go, choice);
    input.focus();
    const submit = (): void => {
        if (input.value.trim()) void doOpen(input.value.trim(), false);
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
    });
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
    const list = el("div", { class: "thumb-grid" });
    body.append(text, select, choose, list, choice);

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
                b.addEventListener("click", () => void open(im.path));
                lazyThumbnail(pic, im);
                return b;
            }),
        );
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

// Thumbnails come from the system one at a time, as the tiles scroll into view; the
// ones seen are kept for the session.
const thumbs = new Map<string, string | null>();
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

function setPicture(pic: HTMLElement, data: string | null): void {
    if (!data) return;
    const img = el("img", {});
    img.src = data;
    img.alt = "";
    pic.replaceChildren(img);
}

function lazyThumbnail(pic: HTMLElement, im: ImageEntry): void {
    const key = `${im.path}:${im.mtime}`;
    if (thumbs.has(key)) return setPicture(pic, thumbs.get(key)!);
    const load = (): void => {
        queue.push(async () => {
            if (!pic.isConnected) return; // the list was replaced meanwhile
            try {
                const data = await nativeThumbnail(im.path, 256);
                thumbs.set(key, data);
                setPicture(pic, data);
            } catch {
                /* keep the placeholder */
            }
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
