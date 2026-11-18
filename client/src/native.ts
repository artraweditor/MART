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

// The bridge to the native app that hosts MART (iOS now, Android later): when
// the page runs in a web view of the app, the app can show the system's pickers. In a browser none of this exists and the page uses paths and
// downloads.

interface NativeHandler {
    postMessage(msg: unknown): Promise<unknown>;
}

function handler(): NativeHandler | null {
    const w = window as unknown as {
        webkit?: { messageHandlers?: { mart?: NativeHandler } };
    };
    return w.webkit?.messageHandlers?.mart ?? null;
}

/** whether the page runs inside the MART app */
export const isNative = (): boolean => handler() !== null;

export interface NativeFolder {
    /** path on the host (the app); images in it are opened in place */
    path: string;
    name: string;
}

/**
 * The folders the app can open images from: its own one, then those the user chose
 * (most recent first).
 */
export async function nativeFolders(): Promise<NativeFolder[]> {
    const h = handler();
    if (!h) throw new Error("not running in the app");
    const r = (await h.postMessage({ cmd: "folders" })) as {
        folders?: NativeFolder[];
    } | null;
    return r?.folders ?? [];
}

/**
 * Let the user choose a folder with the system's picker; the host may open the
 * images in it from then on. Null if the user cancelled.
 */
export async function nativePickFolder(): Promise<NativeFolder | null> {
    const h = handler();
    if (!h) throw new Error("not running in the app");
    const r = (await h.postMessage({ cmd: "pickFolder" })) as {
        folder?: NativeFolder | null;
        error?: string;
    } | null;
    if (r?.error) throw new Error(r.error);
    return r?.folder ?? null;
}

/**
 * A thumbnail of an image in one of the folders, as a data: URL (null: the system
 * has none for this format). `size` is the longest edge in points.
 */
export async function nativeThumbnail(
    path: string,
    size: number,
): Promise<string | null> {
    const h = handler();
    if (!h) throw new Error("not running in the app");
    const r = (await h.postMessage({ cmd: "thumbnail", path, size })) as {
        data?: string | null;
        error?: string;
    } | null;
    if (r?.error) throw new Error(r.error);
    return r?.data ?? null;
}

/**
 * Let the user choose where to save a file that the host has written (one of
 * its exports). Resolves with whether it was saved (false: cancelled).
 */
export async function nativeSaveFile(path: string): Promise<boolean> {
    const h = handler();
    if (!h) throw new Error("not running in the app");
    const r = (await h.postMessage({ cmd: "saveFile", path })) as {
        saved?: boolean;
        error?: string;
    } | null;
    if (r?.error) throw new Error(r.error);
    return r?.saved === true;
}
