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

// The film simulation panel: switch, the LUT (picked from those installed in
// MART's folder, which "Manage LUTs"
// changes), strength, and the controls for the parameters of a CTL script,
// which the engine describes.

import { deleteLut, importLut, listLuts, lutParams, renameLut } from "./api.js";
import type { ClutInfo, LutEntry } from "./api.js";
import { makeControl, registerControl } from "./controls.js";
import type { Control, ControlHost } from "./controls.js";
import {
    GROUP,
    isLutId,
    lutDef,
    lutName,
    matchLut,
    paramDefs,
    presetsDef,
} from "./clut.js";
import { showImport } from "./importdialog.js";
import type { Params } from "./live.js";
import { rowMenu } from "./rowmenu.js";
import { el, openSheet } from "./sheet.js";
import type { ControlDef } from "./tools.js";

// the option of a LUT that the profile has and MART's folder has not
const OTHER = "__other";

export function buildClutPanel(host: ControlHost): Control {
    const root = el("div", { class: "clut" });
    const enabled = makeControl(
        {
            kind: "toggle",
            label: "Enabled",
            group: GROUP,
            key: "Enabled",
            def: false,
        },
        host,
    );
    const strength = makeControl(
        {
            kind: "slider",
            label: "Strength",
            group: GROUP,
            key: "Strength",
            min: 0,
            max: 100,
            step: 1,
            def: 100,
            digits: 0,
        },
        host,
    );
    const lutRow = el("div", { class: "ctl" });
    const lutLabel = el("div", { class: "row" }, el("label", { text: "LUT" }));
    const select = el("select", { class: "lut-select" });
    select.setAttribute("aria-label", "LUT");
    const manageBtn = el("button", {
        class: "chip wide",
        text: "Manage LUTs…",
    });
    manageBtn.type = "button";
    lutRow.append(lutLabel, select, manageBtn);
    const note = el("p", { class: "muted" });
    const dyn = el("div", { class: "clut-params" });
    root.append(enabled.el, lutRow, note, strength.el, dyn);

    let luts: LutEntry[] = [];
    // the LUT just chosen: the profile says its id until the engine reports it
    let picked: LutEntry | null = null;
    let key = ""; // the LUT of the profile, as it says
    // the LUT that the parameter controls are for (what the profile says)
    let builtFor: string | null = null;
    let builtInfo = "";
    let dynControls: Control[] = [];
    let last: Params = {};
    let ticket = 0;

    // the drop-down: none, the LUTs of the folder, and the LUT of the profile
    // if it is not one of them
    const fillSelect = (): void => {
        select.replaceChildren();
        const add = (value: string, text: string): void => {
            const o = el("option", { text });
            o.value = value;
            select.append(o);
        };
        add("", "None");
        for (const l of luts) add(l.id, l.name);
        const match = matchLut(key, luts);
        if (key && !match)
            add(OTHER, `${lutName(key, picked)} (not in MART's folder)`);
        select.value = match ? match.id : key ? OTHER : "";
    };

    const refreshLuts = async (): Promise<void> => {
        try {
            luts = await listLuts();
        } catch {
            /* the list stays as it was */
        }
        fillSelect();
    };

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
        note.textContent = info.error
            ? "The file of this LUT is not on the server, so its parameters " +
              "cannot be shown."
            : "";
        for (const c of dynControls) c.sync(last);
    };

    const refresh = (k: string): void => {
        builtFor = k;
        const mine = ++ticket;
        if (!k) {
            builtInfo = "";
            dyn.replaceChildren();
            dynControls = [];
            note.textContent = "";
            return;
        }
        lutParams(isLutId(k) ? k : undefined)
            .then((info) => {
                if (mine === ticket) rebuild(info);
            })
            .catch(() => {
                if (mine === ticket)
                    note.textContent =
                        "Cannot read the parameters of this LUT.";
            });
    };

    const choose = (entry: LutEntry | null): void => {
        picked = entry;
        host.set(lutDef, entry ? entry.id : "", 0);
    };

    select.addEventListener("change", () => {
        if (select.value === OTHER) return;
        choose(luts.find((l) => l.id === select.value) ?? null);
    });

    // ---- Manage LUTs: import, rename, delete --------------------------------
    const manage = (): void => {
        const sheet = openSheet("LUTs", () => void refreshLuts());
        const importBtn = el("button", {
            class: "action",
            text: "Import a LUT…",
        });
        importBtn.addEventListener("click", () =>
            showImport<LutEntry>({
                title: "Import a LUT",
                what: "a LUT (a Hald CLUT image, a CLF file or a CTL script)",
                accept: ".ctl,.clf,.clfz,.png,.tif,.tiff,.jpg,.jpeg,.json",
                // the name is asked without the extension, which the file keeps
                proposedName: (f) => f.name.replace(/\.[^.]+$/, ""),
                store: (name, f) =>
                    importLut(name + (/\.[^.]+$/.exec(f.name)?.[0] ?? ""), f),
                done: () => manage(),
            }),
        );
        const status = el("p", { class: "muted" });
        const list = el("div", { class: "looks" });
        sheet.body.append(
            el("p", {
                class: "muted",
                text:
                    "The LUTs that the film simulation can use. A profile " +
                    "that holds one of them refers to it by its name here.",
            }),
            importBtn,
            status,
            list,
        );
        const render = (): void => {
            list.replaceChildren();
            status.textContent = luts.length ? "" : "No LUT yet: import one.";
            for (const l of luts) {
                const row = el("div", { class: "look-row" });
                const name = el("span", {
                    class: "row-btn lut-name",
                    text: l.name,
                });
                const more = el("button", { class: "more", text: "⋯" });
                more.type = "button";
                more.setAttribute("aria-expanded", "false");
                more.setAttribute("aria-label", `Rename or delete ${l.name}`);
                row.append(name, more);
                const actions = el("div", { class: "look-actions" });
                actions.hidden = true;
                more.addEventListener("click", () => {
                    actions.hidden = !actions.hidden;
                    more.setAttribute("aria-expanded", String(!actions.hidden));
                    if (!actions.hidden)
                        rowMenu(actions, {
                            initialName: l.name.replace(/\.[^./]+$/, ""),
                            label: l.name,
                            rename: (n) => renameLut(l.id, n),
                            remove: async () => {
                                luts = await deleteLut(l.id);
                            },
                            changed: async () => {
                                luts = await listLuts();
                                render();
                            },
                        });
                });
                list.append(row, actions);
            }
        };
        void (async () => {
            status.textContent = "Loading…";
            try {
                luts = await listLuts();
                render();
            } catch (e) {
                status.textContent = e instanceof Error ? e.message : String(e);
            }
        })();
    };
    manageBtn.addEventListener("click", manage);
    void refreshLuts();

    return {
        el: root,
        sync(params) {
            last = params;
            enabled.sync(params);
            strength.sync(params);
            const k = String(params[GROUP]?.["ClutFilename"] ?? "");
            if (k !== key) {
                key = k;
                fillSelect();
            }
            if (k !== builtFor) refresh(k);
            for (const c of dynControls) c.sync(params);
        },
    };
}

registerControl("clut", (_def, host) => buildClutPanel(host));
