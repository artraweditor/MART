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

// The menu of a row of a list of things of MART's folder (a profile, a LUT):
// rename it, delete it (asked again).

import { el } from "./sheet.js";

export interface RowMenuOps {
    /**
     * what to show in the field when renaming (the name, without what stays: an
     * extension)
     */
    initialName: string;
    /** the name to show in the question when deleting */
    label: string;
    rename(name: string): Promise<unknown>;
    remove(): Promise<unknown>;
    /** it was renamed or deleted: draw the list again */
    changed(): void | Promise<void>;
}

/**
 * fills `box` with the menu: Rename and Delete; each asks what it needs in
 * place
 */
export function rowMenu(box: HTMLElement, o: RowMenuOps): void {
    const message = el("p", { class: "muted look-message" });
    const button = (
        text: string,
        cls: string,
        fn: () => void,
    ): HTMLButtonElement => {
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
        input.value = o.initialName;
        input.setAttribute("aria-label", "New name");
        input.autocapitalize = "off";
        input.spellcheck = false;
        const go = async (): Promise<void> => {
            const n = input.value.trim();
            if (!n) {
                message.textContent = "Give it a name.";
                return;
            }
            try {
                await o.rename(n);
                await o.changed();
            } catch (e) {
                message.textContent =
                    e instanceof Error ? e.message : String(e);
            }
        };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") void go();
        });
        box.replaceChildren(
            input,
            button("Rename", "chip", () => void go()),
            button("Cancel", "chip", menu),
            message,
        );
        input.focus();
        input.select();
    };
    const confirmDelete = (): void => {
        box.replaceChildren(
            el("span", { text: `Delete ${o.label}?` }),
            button("Delete", "chip danger", async () => {
                try {
                    await o.remove();
                    await o.changed();
                } catch (e) {
                    message.textContent =
                        e instanceof Error ? e.message : String(e);
                }
            }),
            button("Cancel", "chip", menu),
            message,
        );
    };
    menu();
}
