// The "Look" sheet: apply a saved ART profile (.arp) to the image.

import { listProfiles, uploadProfile } from "./api.js";
import type { ProfileEntry } from "./api.js";
import { el, openSheet } from "./sheet.js";

const SOURCES: Record<string, string> = { builtin: "Reset", bundled: "ART", user: "Yours", folder: "Folder", uploaded: "Uploaded" };

/** profiles whose name contains every word of `filter`, grouped by source in the order of `SOURCES` */
export function groupProfiles(list: ProfileEntry[], filter: string): [string, ProfileEntry[]][] {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
    const groups: [string, ProfileEntry[]][] = [];
    for (const src of Object.keys(SOURCES)) {
        const g = shown.filter((p) => p.source === src);
        if (g.length) groups.push([src, g]);
    }
    return groups;
}

export interface LooksHost {
    /** apply a profile; resolves when the server has taken it */
    apply(id: string, name: string, append: boolean): void;
}

export async function showLooks(host: LooksHost): Promise<void> {
    const sheet = openSheet("Apply a saved profile");
    const note = el("p", { class: "muted", text: "A profile replaces the settings it contains and leaves the others. Undo restores the image." });
    const filter = el("input", { type: "search", placeholder: "Search profiles" });
    filter.setAttribute("aria-label", "Search profiles");
    const appendBtn = el("button", { class: "chip wide", text: "Add to my local adjustments instead of replacing them" });
    appendBtn.setAttribute("role", "switch");
    appendBtn.setAttribute("aria-checked", "false");
    appendBtn.addEventListener("click", () => appendBtn.setAttribute("aria-checked", String(appendBtn.getAttribute("aria-checked") !== "true")));
    const upload = el("input", { type: "file" });
    upload.accept = ".arp,text/plain";
    upload.hidden = true;
    const uploadBtn = el("button", { class: "action", text: "Use a profile from this device…" });
    uploadBtn.addEventListener("click", () => upload.click());
    const status = el("p", { class: "muted" });
    const list = el("div", { class: "looks" });
    sheet.body.append(note, filter, appendBtn, uploadBtn, upload, status, list);

    let profiles: ProfileEntry[] = [];
    const append = (): boolean => appendBtn.getAttribute("aria-checked") === "true";
    const apply = (p: ProfileEntry): void => {
        host.apply(p.id, p.name, append());
        sheet.close();
    };
    const render = (): void => {
        list.replaceChildren();
        const groups = groupProfiles(profiles, filter.value);
        for (const [src, items] of groups) {
            list.append(el("h3", { text: SOURCES[src] ?? src }));
            for (const p of items) {
                const b = el("button", { class: "row-btn", text: p.name });
                b.addEventListener("click", () => apply(p));
                list.append(b);
            }
        }
        status.textContent = groups.length ? "" : profiles.length ? "No profile matches." : "No profiles found on the server.";
    };
    let timer = 0;
    filter.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(render, 100);
    });
    upload.addEventListener("change", async () => {
        const f = upload.files?.[0];
        if (!f) return;
        if (f.size > 1 << 20) {
            status.textContent = "That file is too large for a profile (1 MiB at most).";
            return;
        }
        try {
            const p = await uploadProfile(f.name, await f.text());
            apply(p);
        } catch (e) {
            status.textContent = e instanceof Error ? e.message : String(e);
        }
    });
    status.textContent = "Loading…";
    try {
        profiles = await listProfiles();
        render();
    } catch (e) {
        status.textContent = e instanceof Error ? e.message : String(e);
    }
}
