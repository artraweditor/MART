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

// The service worker: it keeps the application (not the images, and never the
// server's answers) so that
// MART opens even when the server is away, and then says so clearly instead of
// showing a browser error.
// Editing needs the server: nothing under /api/ is ever cached or answered from
// the cache.

/// <reference lib="webworker" />
const sw = self as unknown as ServiceWorkerGlobalScope;

// replaced by the build: a hash of the files, and the list of them
const VERSION = "__VERSION__";
const SHELL: string[] = JSON.parse("__SHELL__");
const CACHE = `mart-${VERSION}`;

sw.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            // one missing file (or a 401 for a page that needs the access
            // token) must not stop the others
            await Promise.allSettled(SHELL.map((url) => cache.add(url)));
            await sw.skipWaiting();
        })(),
    );
});

sw.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            for (const key of await caches.keys())
                if (key.startsWith("mart-") && key !== CACHE)
                    await caches.delete(key);
            await sw.clients.claim();
        })(),
    );
});

async function networkFirst(request: Request): Promise<Response> {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
    } catch (error) {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
        if (request.mode === "navigate") {
            const page =
                (await cache.match("/index.html")) ?? (await cache.match("/"));
            if (page) return page;
        }
        throw error;
    }
}

sw.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (
        request.method !== "GET" ||
        url.origin !== sw.location.origin ||
        url.pathname.startsWith("/api/")
    )
        return;
    event.respondWith(networkFirst(request));
});
