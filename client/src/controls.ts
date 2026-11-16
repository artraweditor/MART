// The controls of a tool panel: sliders (native range inputs: touch friendly
// and accessible), choice chips and toggles.

import type { ChoiceDef, ControlDef, SliderDef, ToggleDef } from "./tools.js";
import type { Params } from "./live.js";
import { readValue } from "./tools.js";

export interface ControlHost {
    /** a value was set; `gesture` is a gesture id for slider drags, 0 for discrete changes */
    set(def: ControlDef, value: unknown, gesture: number): void;
    /** a slider drag ended */
    gestureEnd(): void;
}

export interface Control {
    el: HTMLElement;
    /** show the value from the engine (ignored while the user is dragging it) */
    sync(params: Params): void;
}

let nextGesture = 1;

function fmt(v: number, digits: number): string {
    return v.toFixed(digits);
}

function slider(def: SliderDef, host: ControlHost): Control {
    const el = document.createElement("div");
    el.className = "ctl";
    const id = `c-${def.group}-${def.key}`.replace(/\W/g, "_");
    el.innerHTML = `<div class="row"><label for="${id}"></label><output></output><button type="button" class="reset" aria-label="Reset"></button></div>`;
    const label = el.querySelector("label")!;
    const out = el.querySelector("output")!;
    const reset = el.querySelector("button")!;
    label.textContent = def.label;
    reset.textContent = "↺";
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(def.def);
    el.appendChild(input);

    let gesture = 0;
    let shown: number | null = null; // the exact value from the engine, until the user moves the slider
    const show = () => {
        const v = shown ?? Number(input.value);
        out.textContent = fmt(v, def.digits);
        reset.classList.toggle("changed", Math.abs(v - def.def) > def.step / 2);
    };
    input.addEventListener("input", () => {
        shown = null;
        if (!gesture) gesture = nextGesture++;
        show();
        host.set(def, Number(input.value), gesture);
    });
    const end = () => {
        if (!gesture) return;
        gesture = 0;
        host.gestureEnd();
    };
    input.addEventListener("change", end);
    input.addEventListener("pointerup", end);
    input.addEventListener("pointercancel", end);
    reset.addEventListener("click", () => {
        shown = null;
        input.value = String(def.def);
        show();
        host.set(def, def.def, 0);
    });
    show();
    return {
        el,
        sync(params) {
            if (gesture) return;
            const v = readValue(params, def);
            const n = typeof v === "number" ? v : def.def;
            // the image can hold a value beyond the nominal range of the slider: widen it, never misreport the value
            input.min = String(Math.min(def.min, Math.floor(n / def.step) * def.step));
            input.max = String(Math.max(def.max, Math.ceil(n / def.step) * def.step));
            input.value = String(n);
            shown = n;
            show();
        },
    };
}

function choice(def: ChoiceDef, host: ControlHost): Control {
    const el = document.createElement("div");
    el.className = "ctl";
    const title = document.createElement("div");
    title.className = "row";
    title.innerHTML = "<label></label>";
    title.firstElementChild!.textContent = def.label;
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.setAttribute("role", "radiogroup");
    const buttons = new Map<string, HTMLButtonElement>();
    for (const o of def.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = o.label;
        b.setAttribute("role", "radio");
        b.addEventListener("click", () => {
            select(o.value);
            host.set(def, o.value, 0);
        });
        buttons.set(o.value, b);
        chips.appendChild(b);
    }
    const select = (v: string) => {
        for (const [value, b] of buttons) b.setAttribute("aria-checked", String(value === v));
    };
    el.append(title, chips);
    select(def.def);
    return {
        el,
        sync(params) {
            const v = readValue(params, def);
            select(typeof v === "string" ? v : def.def);
        },
    };
}

function toggle(def: ToggleDef, host: ControlHost): Control {
    const el = document.createElement("div");
    el.className = "ctl";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip wide";
    b.setAttribute("role", "switch");
    b.textContent = def.label;
    const set = (on: boolean) => b.setAttribute("aria-checked", String(on));
    b.addEventListener("click", () => {
        const on = b.getAttribute("aria-checked") !== "true";
        set(on);
        host.set(def, on, 0);
    });
    el.appendChild(b);
    set(def.def);
    return {
        el,
        sync(params) {
            const v = readValue(params, def);
            set(v === true);
        },
    };
}

export function makeControl(def: ControlDef, host: ControlHost): Control {
    switch (def.kind) {
        case "slider":
            return slider(def, host);
        case "choice":
            return choice(def, host);
        case "toggle":
            return toggle(def, host);
    }
}
