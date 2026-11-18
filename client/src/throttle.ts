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

// At most one edit message per animation frame: the patches of one frame are
// merged (later values win), so no change is lost and the server is not
// flooded.

import type { Patch } from "./live.js";

export class FrameThrottle {
    private pending: Patch | null = null;
    private key = "";
    private queued = false;
    private send: (patch: Patch, mergeKey: string) => void;

    constructor(send: (patch: Patch, mergeKey: string) => void) {
        this.send = send;
    }

    /** Add a patch; `mergeKey` is "" for a discrete change. */
    push(patch: Patch, mergeKey: string): void {
        if (this.pending && this.key !== mergeKey) this.flush();
        this.pending = mergePatch(this.pending ?? {}, patch);
        this.key = mergeKey;
        if (!this.queued) {
            this.queued = true;
            requestAnimationFrame(() => {
                this.queued = false;
                this.flush();
            });
        }
    }

    flush(): void {
        if (!this.pending) return;
        const p = this.pending;
        this.pending = null;
        this.send(p, this.key);
    }
}

export function mergePatch(into: Patch, from: Patch): Patch {
    for (const [g, keys] of Object.entries(from))
        into[g] = { ...(into[g] ?? {}), ...keys };
    return into;
}
