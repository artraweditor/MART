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

// The bridge to the native app that hosts MART (iOS and Android): when the page runs
// in a web view of the app, the app can show the system's pickers. In a browser none
// of this exists and the page uses paths and downloads.
//
// iOS: window.webkit.messageHandlers.mart (WKScriptMessageHandlerWithReply, a promise).
// Android: window.martAndroid.post(id, json) (a @JavascriptInterface object, no return
// value); the app answers with window.__martNativeReply(id, json).

interface NativeHandler {
    postMessage(msg: unknown): Promise<unknown>;
}

interface AndroidBridge {
    post(id: string, json: string): void;
}

interface AndroidWindow {
    martAndroid?: AndroidBridge;
    __martNativeReply?: (id: string, json: string) => void;
}

const pending = new Map<string, (value: unknown) => void>();
let nextId = 1;

function androidHandler(): NativeHandler | null {
    const w = window as unknown as AndroidWindow;
    const bridge = w.martAndroid;
    if (!bridge) return null;
    w.__martNativeReply ??= (id, json) => {
        const done = pending.get(id);
        pending.delete(id);
        done?.(JSON.parse(json));
    };
    return {
        postMessage: (msg) =>
            new Promise((resolve) => {
                const id = String(nextId++);
                pending.set(id, resolve);
                bridge.post(id, JSON.stringify(msg));
            }),
    };
}

function handler(): NativeHandler | null {
    const w = window as unknown as {
        webkit?: { messageHandlers?: { mart?: NativeHandler } };
    };
    return w.webkit?.messageHandlers?.mart ?? androidHandler();
}

/** whether the page runs inside the MART app */
export const isNative = (): boolean => handler() !== null;

export interface NativeFolder {
    /** path on the host (the app); images in it are opened in place */
    path: string;
    name: string;
    /** the app needs the user's permission to read it (see `nativeRequestAccess`) */
    needsAccess?: boolean;
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
 * What the app can do besides the common commands (`photos`: import from the photo library).
 */
export async function nativeCapabilities(): Promise<{ photos?: boolean }> {
    const h = handler();
    if (!h) return {};
    const r = (await h.postMessage({ cmd: "capabilities" })) as {
        photos?: boolean;
    } | null;
    return r ?? {};
}

/**
 * Take the user to where the permission to read the device's folders is given (Android: "all
 * files access"). It is given outside the app: the caller says so and lets the user try again.
 */
export async function nativeRequestAccess(): Promise<void> {
    const h = handler();
    if (!h) throw new Error("not running in the app");
    await h.postMessage({ cmd: "requestAccess" });
}

/**
 * Let the user pick photos from the photo library; the app copies them to a folder of its own
 * (the host edits files, not library assets). Null if the user cancelled.
 */
export async function nativeImportPhotos(): Promise<NativeFolder | null> {
    const h = handler();
    if (!h) throw new Error("not running in the app");
    const r = (await h.postMessage({ cmd: "importPhotos" })) as {
        folder?: NativeFolder | null;
        error?: string;
    } | null;
    if (r?.error) throw new Error(r.error);
    return r?.folder ?? null;
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
