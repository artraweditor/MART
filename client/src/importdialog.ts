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

// A dialog to import a file of the user's into MART's folder (a profile, a
// LUT): the file is chosen with the file
// dialog of the device, and the name it will have is set here.

import { ApiError } from "./api.js";
import { el, openSheet } from "./sheet.js";

export interface ImportOptions<T> {
    title: string;
    /** what is imported, for the text of the dialog: "a profile" */
    what: string;
    /** the types that the file dialog offers: ".arp,text/plain" */
    accept: string;
    /** the name proposed for a file */
    proposedName: (file: File) => string;
    /**
     * store the file under this name; ApiError 409 means that the name is taken
     */
    store: (name: string, file: File) => Promise<T>;
    /** it was stored (the dialog is closed) */
    done: (stored: T) => void;
}

export function showImport<T>(o: ImportOptions<T>): void {
    const sheet = openSheet(o.title);
    const input = el("input", { type: "file" });
    input.accept = o.accept;
    input.hidden = true;
    const choose = el("button", {
        class: "action secondary",
        text: "Choose a file…",
    });
    choose.type = "button";
    const chosen = el("p", { class: "muted", text: "No file chosen." });
    const name = el("input", { type: "text", placeholder: "Name" });
    name.setAttribute("aria-label", "Name");
    name.autocapitalize = "off";
    name.spellcheck = false;
    const status = el("p", { class: "muted" });
    const go = el("button", { class: "action", text: "Import" });
    go.disabled = true;
    sheet.body.append(
        el("p", {
            class: "muted",
            text:
                `Import ${o.what} from a file of this device: it is kept in ` +
                `MART's folder, under the name below.`,
        }),
        choose,
        input,
        chosen,
        el(
            "div",
            { class: "ctl" },
            el("div", { class: "row" }, el("label", { text: "Name" })),
            name,
        ),
        status,
        go,
    );

    let file: File | null = null;
    const ready = (): void => {
        go.disabled = !file || !name.value.trim();
    };
    choose.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
        file = input.files?.[0] ?? null;
        chosen.textContent = file ? file.name : "No file chosen.";
        if (file) name.value = o.proposedName(file);
        status.textContent = "";
        ready();
    });
    name.addEventListener("input", () => {
        status.textContent = "";
        ready();
    });
    go.addEventListener("click", async () => {
        if (!file) return;
        go.disabled = true;
        status.textContent = "Importing…";
        try {
            const stored = await o.store(name.value.trim(), file);
            sheet.close();
            o.done(stored);
        } catch (e) {
            // a name that is taken stays in the field, to be changed
            status.textContent =
                e instanceof ApiError || e instanceof Error
                    ? e.message
                    : String(e);
            ready();
        }
    });
}
