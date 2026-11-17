// The film simulation panel: switch, LUT (from the server's folders or from this device), strength, and the
// controls for the parameters of a CTL script, which the engine describes.

import { listLuts, lutParams, uploadLut } from "./api.js";
import type { ClutInfo, LutEntry } from "./api.js";
import { makeControl, registerControl } from "./controls.js";
import type { Control, ControlHost } from "./controls.js";
import { GROUP, isLutId, lutDef, lutName, paramDefs, presetsDef } from "./clut.js";
import type { Params } from "./live.js";
import { el, openSheet } from "./sheet.js";
import type { ControlDef } from "./tools.js";

const SOURCES: Record<string, string> = { bundled: "ART", user: "Yours", folder: "Folder", uploaded: "Uploaded" };

export function buildClutPanel(host: ControlHost): Control {
    const root = el("div", { class: "clut" });
    const enabled = makeControl({ kind: "toggle", label: "Enabled", group: GROUP, key: "Enabled", def: false }, host);
    const strength = makeControl({ kind: "slider", label: "Strength", group: GROUP, key: "Strength", min: 0, max: 100, step: 1, def: 100, digits: 0 }, host);
    const lutRow = el("div", { class: "ctl" });
    const lutLabel = el("div", { class: "row" }, el("label", { text: "LUT" }));
    const lutBtn = el("button", { class: "chip wide", type: "button" });
    lutBtn.setAttribute("aria-haspopup", "dialog");
    lutRow.append(lutLabel, lutBtn);
    const note = el("p", { class: "muted" });
    const dyn = el("div", { class: "clut-params" });
    root.append(enabled.el, lutRow, note, strength.el, dyn);

    let picked: LutEntry | null = null; // the LUT just chosen: the profile says its id until the engine reports it
    let builtFor: string | null = null; // the LUT that the parameter controls are for (what the profile says)
    let builtInfo = "";
    let dynControls: Control[] = [];
    let last: Params = {};
    let ticket = 0;

    const rebuild = (info: ClutInfo): void => {
        const json = JSON.stringify(info);
        if (json === builtInfo) return;
        builtInfo = json;
        dyn.replaceChildren();
        dynControls = [];
        const defs: ControlDef[] = [];
        const presets = presetsDef(info);
        if (presets) defs.push(presets);
        defs.push(...paramDefs(info));
        for (const d of defs) {
            const c = makeControl(d, host);
            dynControls.push(c);
            dyn.appendChild(c.el);
        }
        note.textContent = info.error ? "The file of this LUT is not on the server, so its parameters cannot be shown." : "";
        for (const c of dynControls) c.sync(last);
    };

    const refresh = (key: string): void => {
        builtFor = key;
        const mine = ++ticket;
        if (!key) {
            builtInfo = "";
            dyn.replaceChildren();
            dynControls = [];
            note.textContent = "";
            return;
        }
        lutParams(isLutId(key) ? key : undefined)
            .then((info) => {
                if (mine === ticket) rebuild(info);
            })
            .catch(() => {
                if (mine === ticket) note.textContent = "Cannot read the parameters of this LUT.";
            });
    };

    const choose = (entry: LutEntry | null): void => {
        picked = entry;
        host.set(lutDef, entry ? entry.id : "", 0);
    };

    lutBtn.addEventListener("click", () => {
        void (async () => {
            const sheet = openSheet("LUT for the film simulation");
            const none = el("button", { class: "row-btn", text: "None" });
            none.addEventListener("click", () => {
                choose(null);
                sheet.close();
            });
            const upload = el("input", { type: "file" });
            upload.accept = ".ctl,.clf,.clfz,.png,.tif,.tiff,.jpg,.jpeg,.json";
            upload.hidden = true;
            const uploadBtn = el("button", { class: "action", text: "Use a LUT from this device…" });
            uploadBtn.addEventListener("click", () => upload.click());
            const status = el("p", { class: "muted" });
            const list = el("div", { class: "looks" });
            sheet.body.append(el("p", { class: "muted", text: "A LUT image (Hald CLUT), a CLF file, or a CTL script. A script can have parameters." }), uploadBtn, upload, status, list);
            upload.addEventListener("change", async () => {
                const f = upload.files?.[0];
                if (!f) return;
                status.textContent = "Sending…";
                try {
                    choose(await uploadLut(f.name, f));
                    sheet.close();
                } catch (e) {
                    status.textContent = e instanceof Error ? e.message : String(e);
                }
            });
            status.textContent = "Loading…";
            try {
                const luts = await listLuts();
                status.textContent = luts.length ? "" : "The server offers no LUT folder; send one from this device.";
                list.append(none);
                for (const src of Object.keys(SOURCES)) {
                    const items = luts.filter((l) => l.source === src);
                    if (!items.length) continue;
                    list.append(el("h3", { text: SOURCES[src] ?? src }));
                    for (const l of items) {
                        const b = el("button", { class: "row-btn", text: l.name });
                        b.addEventListener("click", () => {
                            choose(l);
                            sheet.close();
                        });
                        list.append(b);
                    }
                }
            } catch (e) {
                status.textContent = e instanceof Error ? e.message : String(e);
            }
        })();
    });

    return {
        el: root,
        sync(params) {
            last = params;
            enabled.sync(params);
            strength.sync(params);
            const key = String(params[GROUP]?.["ClutFilename"] ?? "");
            lutBtn.textContent = lutName(key, picked) || "Choose a LUT…";
            if (key !== builtFor) refresh(key);
            for (const c of dynControls) c.sync(params);
        },
    };
}

registerControl("clut", (_def, host) => buildClutPanel(host));
