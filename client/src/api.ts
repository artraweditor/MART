// HTTP access to the MART host.

export interface ImageInfo {
    file: string;
    is_raw: boolean;
    source_width: number;
    source_height: number;
    full_width: number;
    full_height: number;
    make: string | null;
    model: string | null;
    lens: string | null;
    iso: number | null;
    f_number: number | null;
    focal_length_mm: number | null;
    shutter_s: number | null;
    exposure_compensation: number | null;
    orientation: string | null;
}

export interface Status {
    version: string;
    art_version: string;
    backend: "inprocess" | "remote";
    open: { file: string } | null;
    busy: string | null;
}

export interface Region {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The server answered with an error. */
export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

/** The server could not be reached at all. */
export class NetworkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NetworkError";
    }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (e) {
        throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
        let msg = res.statusText;
        try {
            msg = ((await res.json()) as { error?: string }).error ?? msg;
        } catch {
            /* not JSON */
        }
        throw new ApiError(res.status, msg);
    }
    return res;
}

export async function getStatus(): Promise<Status> {
    return (await request("/api/status", { cache: "no-store" })).json();
}

export async function getInfo(): Promise<ImageInfo> {
    return (await request("/api/info", { cache: "no-store" })).json();
}

/** Open an image. Without `discard` an image with unsaved edits is refused (ApiError 409). */
export async function openImage(path: string, discard = false): Promise<ImageInfo> {
    const res = await request("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, discard }),
    });
    return res.json();
}

export type Metadata = Record<string, string | number | boolean | null | (string | number)[]>;

/** Every tag of the image: as in the file (`edits` false) or with the edits applied. Maker notes need ExifTool and are slow. */
export async function getMetadata(makernotes: boolean, edits: boolean): Promise<Metadata> {
    const q = new URLSearchParams({ makernotes: makernotes ? "1" : "0", edits: edits ? "1" : "0" });
    return (await request(`/api/metadata?${q}`, { cache: "no-store" })).json();
}

export interface ProfileEntry {
    id: string;
    name: string;
    source: string; // "bundled", "user", "folder", "uploaded"
}

export async function listProfiles(): Promise<ProfileEntry[]> {
    return (await request("/api/profiles", { cache: "no-store" })).json();
}

/** Send the text of an .arp; it is then in the list. */
export async function uploadProfile(name: string, text: string): Promise<ProfileEntry> {
    const res = await request(`/api/profiles?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: text,
    });
    return res.json();
}

export interface SpotWB {
    temperature: number;
    tint: number;
}

/** The white balance that makes this rectangle (image pixels) neutral. */
export async function spotWB(x: number, y: number, w: number, h: number): Promise<SpotWB> {
    const res = await request("/api/wb/spot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y, w, h }),
    });
    return res.json();
}

export async function saveImage(): Promise<{ file: string }> {
    return (await request("/api/save", { method: "POST" })).json();
}
