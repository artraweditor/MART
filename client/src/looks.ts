// The "Look" sheet: apply a profile (a partial .arp) to the image, save the current settings as a profile of MART,
// and choose the profile for images that have no sidecar.

import { ApiError, deleteProfile, listProfiles, profileSections, renameProfile, saveProfile, setDefaultProfile, uploadProfile } from "./api.js";
import type { ProfileEntry } from "./api.js";
import { el, openSheet } from "./sheet.js";

const SOURCES: Record<string, string> = { builtin: "Reset", mine: "My profiles", uploaded: "From this device" };

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
    /** a profile was saved */
    saved(name: string): void;
}

export async function showLooks(host: LooksHost): Promise<void> {
    const sheet = openSheet("Profiles");
    const note = el("p", {
        class: "muted",
        text: "A profile replaces the settings it contains and leaves the others. Undo restores the image. The star marks the profile that is applied to a picture when it is opened without a sidecar.",
    });
    const filter = el("input", { type: "search", placeholder: "Search profiles" });
    filter.setAttribute("aria-label", "Search profiles");
    const appendBtn = el("button", { class: "chip wide", text: "Add to my local adjustments instead of replacing them" });
    appendBtn.setAttribute("role", "switch");
    appendBtn.setAttribute("aria-checked", "false");
    appendBtn.addEventListener("click", () => appendBtn.setAttribute("aria-checked", String(appendBtn.getAttribute("aria-checked") !== "true")));
    const saveBtn = el("button", { class: "action", text: "Save the current settings as a profile…" });
    saveBtn.addEventListener("click", () => void showSaveProfile(host));
    const upload = el("input", { type: "file" });
    upload.accept = ".arp,text/plain";
    upload.hidden = true;
    const uploadBtn = el("button", { class: "action secondary", text: "Use a profile from this device…" });
    uploadBtn.addEventListener("click", () => upload.click());
    const status = el("p", { class: "muted" });
    const list = el("div", { class: "looks" });
    sheet.body.append(note, saveBtn, uploadBtn, upload, filter, appendBtn, status, list);

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
                const row = el("div", { class: "look-row" });
                const b = el("button", { class: "row-btn", text: p.name });
                b.addEventListener("click", () => apply(p));
                row.append(b);
                if (p.source === "mine") {
                    // the default for pictures opened without a sidecar: at most one
                    const star = el("button", { class: "star", text: p.default ? "★" : "☆" });
                    star.type = "button";
                    star.setAttribute("aria-pressed", String(p.default === true));
                    star.setAttribute("aria-label", `Use ${p.name} for pictures opened without a sidecar`);
                    star.title = p.default ? "The profile for new pictures: tap to remove" : "Use for pictures opened without a sidecar";
                    star.addEventListener("click", async () => {
                        try {
                            profiles = await setDefaultProfile(p.default ? null : p.id);
                            render();
                        } catch (e) {
                            status.textContent = e instanceof Error ? e.message : String(e);
                        }
                    });
                    const more = el("button", { class: "more", text: "⋯" });
                    more.type = "button";
                    more.setAttribute("aria-expanded", "false");
                    more.setAttribute("aria-label", `Rename or delete ${p.name}`);
                    row.append(star, more);
                    const actions = el("div", { class: "look-actions" });
                    actions.hidden = true;
                    more.addEventListener("click", () => {
                        actions.hidden = !actions.hidden;
                        more.setAttribute("aria-expanded", String(!actions.hidden));
                        if (!actions.hidden) showActions(p, actions);
                    });
                    list.append(row, actions);
                    continue;
                }
                list.append(row);
            }
        }
        status.textContent = groups.length ? "" : profiles.length ? "No profile matches." : "No profiles yet.";
    };
    // what can be done with a profile of MART: rename it, delete it (asked again before it is done)
    const showActions = (p: ProfileEntry, box: HTMLElement): void => {
        const message = el("p", { class: "muted look-message" });
        const button = (text: string, cls: string, fn: () => void): HTMLButtonElement => {
            const b = el("button", { class: cls, text });
            b.type = "button";
            b.addEventListener("click", fn);
            return b;
        };
        const menu = (): void => {
            box.replaceChildren(
                button("Rename", "chip", rename),
                button("Delete", "chip", confirmDelete),
            );
        };
        const rename = (): void => {
            const input = el("input", { type: "text" });
            input.value = p.name;
            input.setAttribute("aria-label", "New name");
            input.autocapitalize = "off";
            input.spellcheck = false;
            const go = async (): Promise<void> => {
                const n = input.value.trim();
                if (!n) {
                    message.textContent = "Give the profile a name.";
                    return;
                }
                try {
                    await renameProfile(p.id, n);
                    profiles = await listProfiles();
                    render();
                } catch (e) {
                    message.textContent = e instanceof Error ? e.message : String(e);
                }
            };
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") void go();
            });
            box.replaceChildren(input, button("Rename", "chip", () => void go()), button("Cancel", "chip", menu), message);
            input.focus();
            input.select();
        };
        const confirmDelete = (): void => {
            box.replaceChildren(
                el("span", { text: `Delete ${p.name}?` }),
                button("Delete", "chip danger", async () => {
                    try {
                        profiles = await deleteProfile(p.id);
                        render();
                    } catch (e) {
                        message.textContent = e instanceof Error ? e.message : String(e);
                    }
                }),
                button("Cancel", "chip", menu),
                message,
            );
        };
        menu();
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

/** Save the current settings: a name, and which sections of the interface to keep. */
export async function showSaveProfile(host: LooksHost): Promise<void> {
    const sheet = openSheet("Save a profile");
    const name = el("input", { type: "text", placeholder: "Name of the profile" });
    name.setAttribute("aria-label", "Name of the profile");
    name.autocapitalize = "off";
    name.spellcheck = false;
    const status = el("p", { class: "muted" });
    const boxes = el("div", { class: "sections" });
    const go = el("button", { class: "action", text: "Save" });
    sheet.body.append(
        el("p", { class: "muted", text: "Choose what the profile keeps: the settings of the checked sections, as they are now." }),
        el("div", { class: "ctl" }, el("div", { class: "row" }, el("label", { text: "Name" })), name),
        boxes,
        status,
        go,
    );

    const checked = new Map<string, HTMLButtonElement>();
    try {
        for (const s of await profileSections()) {
            const b = el("button", { class: "chip wide", text: s.label });
            b.type = "button";
            b.setAttribute("role", "checkbox");
            b.setAttribute("aria-checked", String(s.default));
            b.addEventListener("click", () => b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true")));
            checked.set(s.id, b);
            boxes.append(b);
        }
    } catch (e) {
        status.textContent = e instanceof Error ? e.message : String(e);
        return;
    }
    const chosen = (): string[] => [...checked].filter(([, b]) => b.getAttribute("aria-checked") === "true").map(([id]) => id);

    let replace = false; // the name is taken: the next tap on the button replaces that profile
    name.addEventListener("input", () => {
        replace = false;
        go.textContent = "Save";
        status.textContent = "";
    });
    go.addEventListener("click", async () => {
        const n = name.value.trim();
        if (!n) {
            status.textContent = "Give the profile a name.";
            return;
        }
        if (!chosen().length) {
            status.textContent = "Check at least one section.";
            return;
        }
        go.disabled = true;
        try {
            const p = await saveProfile(n, chosen(), replace);
            host.saved(p.name);
            sheet.close();
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
                replace = true;
                go.textContent = "Replace it";
            }
            status.textContent = e instanceof Error ? e.message : String(e);
        } finally {
            go.disabled = false;
        }
    });
    name.focus();
}
