// The controls of a tool panel: sliders (native range inputs: touch friendly
// and accessible), choice chips and toggles.

import type { ChoiceDef, ControlDef, CurveDef, CustomDef, HeadingDef, SliderDef, ToggleDef } from "./tools.js";
import { addPoint, encode, hitPoint, identity, isIdentity, makeEvaluator, movePoint, parseCurve, removePoint } from "./curve.js";
import type { Curve } from "./curve.js";
import type { Params } from "./live.js";
import { isShown, readValue } from "./tools.js";

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
    const id = `c-${def.group}-${def.key}-${def.index ?? ""}`.replace(/\W/g, "_");
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
    const buttons = new Map<string, HTMLButtonElement>();  // by String(value): the profile's Mode is a number
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
        buttons.set(String(o.value), b);
        chips.appendChild(b);
    }
    const select = (v: string | number) => {
        for (const [value, b] of buttons) b.setAttribute("aria-checked", String(value === String(v)));
    };
    el.append(title, chips);
    select(def.def);
    return {
        el,
        sync(params) {
            const v = readValue(params, def);
            select(typeof v === "string" || typeof v === "number" ? v : def.def);
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

function heading(def: HeadingDef): Control {
    const el = document.createElement("h3");
    el.className = "tool-heading";
    el.textContent = def.label;
    return { el, sync() {} };
}

/** The tone curve: tap to add a point, drag to move it, double-tap a point (or "Remove point") to delete it. */
function curveEditor(def: CurveDef, host: ControlHost): Control {
    const el = document.createElement("div");
    el.className = "ctl curve-ctl";
    el.innerHTML =
        `<div class="row"><label></label><button type="button" class="reset changed" aria-label="Reset the curve">↺</button></div>` +
        `<canvas class="curve" role="img" aria-label="Tone curve editor"></canvas>` +
        `<div class="row"><button type="button" class="chip remove" disabled>Remove point</button><span class="muted note"></span></div>`;
    el.querySelector("label")!.textContent = def.label;
    const canvas = el.querySelector("canvas")!;
    const reset = el.querySelector<HTMLButtonElement>(".reset")!;
    const remove = el.querySelector<HTMLButtonElement>(".remove")!;
    const note = el.querySelector<HTMLElement>(".note")!;
    const ctx = canvas.getContext("2d")!;

    let curve: Curve | null = identity(); // null: a curve this editor cannot show
    let selected = -1;
    let drag = -1;
    let gesture = 0;
    let lastTap = { t: 0, i: -1 };
    const css = (name: string): string => getComputedStyle(el).getPropertyValue(name).trim() || "#888";

    const side = (): number => canvas.clientWidth;
    const pad = 12;
    const toPx = (x: number, y: number): [number, number] => [pad + x * (side() - 2 * pad), side() - pad - y * (side() - 2 * pad)];
    const toUnit = (px: number, py: number): [number, number] => [(px - pad) / (side() - 2 * pad), (side() - pad - py) / (side() - 2 * pad)];

    const size = (): void => {
        const dpr = window.devicePixelRatio || 1;
        const s = side();
        canvas.width = Math.max(1, Math.round(s * dpr));
        canvas.height = Math.max(1, Math.round(s * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    };

    const draw = (): void => {
        const s = side();
        if (!s) return;
        ctx.clearRect(0, 0, s, s);
        ctx.lineWidth = 1;
        ctx.strokeStyle = css("--line");
        for (let i = 0; i <= 4; i++) {
            const [x0, y0] = toPx(i / 4, 0);
            const [x1, y1] = toPx(i / 4, 1);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            const [a0, b0] = toPx(0, i / 4);
            const [a1, b1] = toPx(1, i / 4);
            ctx.moveTo(a0, b0);
            ctx.lineTo(a1, b1);
            ctx.stroke();
        }
        ctx.strokeStyle = css("--muted");
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(...toPx(0, 0));
        ctx.lineTo(...toPx(1, 1));
        ctx.stroke();
        ctx.setLineDash([]);
        if (!curve) return;
        const f = makeEvaluator(curve);
        ctx.strokeStyle = css("--accent");
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 128; i++) {
            const x = i / 128;
            const [px, py] = toPx(x, f(x));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        curve.pts.forEach(([x, y], i) => {
            const [px, py] = toPx(x, y);
            ctx.beginPath();
            ctx.arc(px, py, i === selected ? 9 : 7, 0, Math.PI * 2);
            ctx.fillStyle = i === selected ? css("--accent") : css("--panel");
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = css("--accent");
            ctx.stroke();
        });
    };

    const status = (): void => {
        remove.disabled = !curve || selected <= 0 || selected >= curve.pts.length - 1;
        note.textContent = curve ? "" : "A curve of another kind: reset it to edit here.";
        reset.classList.toggle("changed", !curve || !isIdentity(curve));
        canvas.style.opacity = curve ? "1" : "0.5";
    };

    const send = (g: number): void => {
        if (curve) host.set(def, encode(curve), g);
    };

    const local = (e: PointerEvent): [number, number] => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };
    const hit = (px: number, py: number): number => {
        if (!curve) return -1;
        // a finger needs a larger target than a mouse: 22 CSS px, in curve units
        const [x, y] = toUnit(px, py);
        return hitPoint(curve.pts, x, y, 22 / (side() - 2 * pad));
    };

    canvas.addEventListener("pointerdown", (e) => {
        if (!curve) return;
        canvas.setPointerCapture(e.pointerId);
        const [px, py] = local(e);
        let i = hit(px, py);
        const now = performance.now();
        if (i >= 0 && lastTap.i === i && now - lastTap.t < 350 && i > 0 && i < curve.pts.length - 1) {
            // a double tap on a point deletes it
            curve = { ...curve, pts: removePoint(curve.pts, i) };
            selected = -1;
            lastTap = { t: 0, i: -1 };
            draw();
            status();
            send(0);
            return;
        }
        if (i < 0) {
            const [x, y] = toUnit(px, py);
            const a = addPoint(curve.pts, Math.min(1, Math.max(0, x)), y);
            curve = { ...curve, pts: a.pts };
            i = a.index;
        }
        lastTap = { t: now, i };
        selected = drag = i;
        gesture = nextGesture++;
        draw();
        status();
        // a new point lies on the curve as it is: nothing is sent until it is moved
    });
    canvas.addEventListener("pointermove", (e) => {
        if (drag < 0 || !curve) return;
        const [px, py] = local(e);
        const [x, y] = toUnit(px, py);
        curve = { ...curve, pts: movePoint(curve.pts, drag, x, y) };
        lastTap = { t: 0, i: -1 };
        draw();
        status();
        send(gesture);
    });
    const end = (): void => {
        if (drag < 0) return;
        drag = -1;
        if (gesture) {
            gesture = 0;
            host.gestureEnd();
        }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    remove.addEventListener("click", () => {
        if (!curve || selected <= 0 || selected >= curve.pts.length - 1) return;
        curve = { ...curve, pts: removePoint(curve.pts, selected) };
        selected = -1;
        draw();
        status();
        send(0);
    });
    reset.addEventListener("click", () => {
        curve = identity();
        selected = -1;
        draw();
        status();
        host.set(def, [0], 0);
    });
    new ResizeObserver(size).observe(canvas);
    status();
    return {
        el,
        sync(params) {
            if (drag >= 0) return;
            curve = parseCurve(params[def.group]?.[def.key]);
            if (curve && selected >= curve.pts.length) selected = -1;
            draw();
            status();
        },
    };
}

type Factory = (def: CustomDef, host: ControlHost) => Control;
const factories = new Map<string, Factory>();

/** a module that builds a whole panel registers it under the name its `custom` definition gives */
export function registerControl(name: string, factory: Factory): void {
    factories.set(name, factory);
}

export function makeControl(def: ControlDef, host: ControlHost): Control {
    const c = build(def, host);
    if (!def.showWhen) return c;
    c.el.hidden = !isShown({}, def);
    // shown only while another setting of the tool has the right value
    return {
        el: c.el,
        sync(params) {
            c.el.hidden = !isShown(params, def);
            c.sync(params);
        },
    };
}

function build(def: ControlDef, host: ControlHost): Control {
    switch (def.kind) {
        case "slider":
            return slider(def, host);
        case "choice":
            return choice(def, host);
        case "toggle":
            return toggle(def, host);
        case "curve":
            return curveEditor(def, host);
        case "heading":
            return heading(def);
        case "custom": {
            const f = factories.get(def.name);
            if (!f) throw new Error(`no panel registered for ${def.name}`);
            return f(def, host);
        }
    }
}
