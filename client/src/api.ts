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
    dirty: boolean;
    busy: string | null; // "exporting" while the engine is busy with an export
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

export interface ExportOptions {
    format: "jpg" | "png" | "tif";
    quality?: number; // jpg: 1..100
    bits?: number; // png: 8 or 16; tif: 8, 16 or 32
    float?: boolean; // tif with 16 bits
    compression?: "none" | "zip"; // tif
    size?: number; // the longest edge in pixels at most; full size if absent
    name?: string; // file name without extension; the image's name if empty
}

export interface ExportStatus {
    state: "queued" | "running" | "done" | "error";
    format: string;
    elapsed_ms: number;
    name?: string;
    width?: number;
    height?: number;
    bytes?: number;
    path?: string; // where the server keeps it, if it keeps exported files
    error?: string;
}

/** Start an export (full size, or as large as `size` at most) of the image as it is now (unsaved edits included). Resolves with the job id. */
export async function startExport(o: ExportOptions): Promise<string> {
    const res = await request("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(o),
    });
    return ((await res.json()) as { job: string }).job;
}

export async function exportStatus(job: string): Promise<ExportStatus> {
    return (await request(`/api/export/${encodeURIComponent(job)}`, { cache: "no-store" })).json();
}

/** The address of the exported file, to download it. */
export function exportUrl(job: string): string {
    return `/api/export/${encodeURIComponent(job)}/file`;
}

export interface LutEntry {
    id: string;
    name: string;
    source: string; // "bundled", "user", "folder", "uploaded"
}

export async function listLuts(): Promise<LutEntry[]> {
    return (await request("/api/luts", { cache: "no-store" })).json();
}

/** Send a LUT, a CTL script or a Hald CLUT image from this device; it is then in the list. */
export async function uploadLut(name: string, data: Blob): Promise<LutEntry> {
    const res = await request(`/api/luts?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
    });
    return res.json();
}

/** one parameter of a CTL script, as the engine describes it */
export interface ClutParam {
    name: string;
    type: "int" | "float" | "bool" | "choice" | "curve" | "flatcurve" | "flatcurve_periodic" | "huesat";
    label: string;
    group: string;
    tooltip: string;
    min: number;
    max: number;
    step: number;
    default: number[];
    choices?: { label: string; value: number }[];
}

export interface ClutPreset {
    key: string;
    label: string;
    values: Record<string, number[]>;
}

export interface ClutInfo {
    params: ClutParam[];
    presets: ClutPreset[];
    error?: string;
}

/** The parameters of a LUT: of the one in the profile, or of the one with this id (the host's id from `listLuts`). */
export async function lutParams(id?: string): Promise<ClutInfo> {
    const q = id ? `?id=${encodeURIComponent(id)}` : "";
    return (await request(`/api/lut/params${q}`, { cache: "no-store" })).json();
}
