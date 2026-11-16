// A modal sheet: a bottom sheet on a phone, a centred card on a tablet.

export interface Sheet {
    body: HTMLElement;
    close(): void;
}

let current: { close(): void } | null = null;

export function openSheet(title: string, onClose?: () => void): Sheet {
    current?.close();
    const root = document.getElementById("sheet")!;
    const heading = root.querySelector<HTMLElement>(".sheet-title")!;
    const body = root.querySelector<HTMLElement>(".sheet-body")!;
    const closeBtn = root.querySelector<HTMLButtonElement>(".sheet-close")!;
    heading.textContent = title;
    body.replaceChildren();
    body.scrollTop = 0;
    root.hidden = false;
    const opener = document.activeElement as HTMLElement | null;

    const close = (): void => {
        if (current !== self) return;
        current = null;
        root.hidden = true;
        body.replaceChildren();
        root.removeEventListener("click", onBackdrop);
        closeBtn.removeEventListener("click", close);
        document.removeEventListener("keydown", onKey);
        opener?.focus?.();
        onClose?.();
    };
    const onBackdrop = (e: Event): void => {
        if (e.target === root) close();
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === "Escape") close();
    };
    const self = { close };
    current = self;
    root.addEventListener("click", onBackdrop);
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    closeBtn.focus();
    return { body, close };
}

/** tiny element helper: el("button", {class: "chip", text: "x"}) */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: { class?: string; text?: string; type?: string; placeholder?: string; title?: string } = {},
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (attrs.class) e.className = attrs.class;
    if (attrs.text !== undefined) e.textContent = attrs.text;
    if (attrs.type) (e as unknown as HTMLInputElement).type = attrs.type;
    if (attrs.placeholder) (e as unknown as HTMLInputElement).placeholder = attrs.placeholder;
    if (attrs.title) e.title = attrs.title;
    for (const c of children) e.append(c);
    return e;
}
