// Open another image, by its path on the machine running MART. Unsaved edits are never dropped silently.

import { ApiError, openImage } from "./api.js";
import type { ImageInfo } from "./api.js";
import { el, openSheet } from "./sheet.js";

export interface OpenHost {
    /** save the current image (rejects on failure) */
    save(): Promise<void>;
    opened(info: ImageInfo): void;
}

export function showOpen(host: OpenHost): void {
    const sheet = openSheet("Open an image");
    const text = el("p", { class: "muted", text: "Type the path of a raw file on the machine running MART." });
    const input = el("input", { type: "text", placeholder: "/path/to/photo.arw" });
    input.setAttribute("aria-label", "Path of the image on the server");
    input.autocapitalize = "off";
    input.spellcheck = false;
    const go = el("button", { class: "action", text: "Open" });
    const choice = el("div", { class: "choice" });
    sheet.body.append(text, input, go, choice);
    input.focus();

    const doOpen = async (discard: boolean): Promise<void> => {
        choice.replaceChildren();
        try {
            const info = await openImage(input.value.trim(), discard);
            sheet.close();
            host.opened(info);
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
                const saveOpen = el("button", { class: "action", text: "Save, then open" });
                const discardOpen = el("button", { class: "action danger", text: "Discard the edits and open" });
                saveOpen.addEventListener("click", async () => {
                    try {
                        await host.save();
                        await doOpen(false);
                    } catch (err) {
                        text.textContent = err instanceof Error ? err.message : String(err);
                    }
                });
                discardOpen.addEventListener("click", () => void doOpen(true));
                choice.append(el("p", { text: "The current image has edits that are not saved." }), saveOpen, discardOpen);
            } else {
                text.textContent = e instanceof Error ? e.message : String(e);
            }
        }
    };
    const submit = (): void => {
        if (input.value.trim()) void doOpen(false);
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
    });
}
