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

/**
 * Open an image. Without `discard` an image with unsaved edits is refused
 * (ApiError 409).
 */
export async function openImage(
    path: string,
    discard = false,
): Promise<ImageInfo> {
    const res = await request("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, discard }),
    });
    return res.json();
}

export interface ImageEntry {
    name: string;
    path: string;
    size: number;
    /** seconds since the epoch */
    mtime: number;
    /** there is a sidecar (.arp) next to it */
    edited: boolean;
}

/**
 * The address of the thumbnail of an image of a folder (a JPEG whose longest edge is at most `size`
 * pixels; made by the host with libART, from the embedded preview of a raw). The file's mtime is
 * in the address, so that the browser's copy is current.
 */
export function thumbnailUrl(im: ImageEntry, size: number): string {
    return `/api/thumbnail?path=${encodeURIComponent(im.path)}&size=${size}&v=${im.mtime}`;
}

/** A folder that the host may read: its subfolders and its images. */
export interface FolderListing {
    /** the folder ("" is the list of the folders that the host allows) */
    dir: string;
    /** the folder above, if it may be browsed too ("": the list of the allowed folders) */
    parent: string;
    dirs: { name: string; path: string }[];
    images: ImageEntry[];
}

/** The subfolders and the images of a folder that the host may read ("" lists the allowed folders). */
export async function browseFolder(dir: string): Promise<FolderListing> {
    const res = await request("/api/images?dir=" + encodeURIComponent(dir));
    return (await res.json()) as FolderListing;
}

/** The images in a folder that the host may read. */
export async function listImages(dir: string): Promise<ImageEntry[]> {
    return (await browseFolder(dir)).images;
}

export type Metadata = Record<
    string,
    string | number | boolean | null | (string | number)[]
>;

/**
 * Every tag of the image: as in the file (`edits` false) or with the edits
 * applied. Maker notes need ExifTool and are slow.
 */
export async function getMetadata(
    makernotes: boolean,
    edits: boolean,
): Promise<Metadata> {
    const q = new URLSearchParams({
        makernotes: makernotes ? "1" : "0",
        edits: edits ? "1" : "0",
    });
    return (await request(`/api/metadata?${q}`, { cache: "no-store" })).json();
}

export interface ProfileEntry {
    id: string;
    name: string;
    source: string; // "builtin", "mine" (MART's folder), "uploaded"
    /** the profile applied to images that are opened without a sidecar */
    default?: boolean;
}

export async function listProfiles(): Promise<ProfileEntry[]> {
    return (await request("/api/profiles", { cache: "no-store" })).json();
}

/**
 * Store a profile from a file of the user's in MART's folder, under this name
 * (the text of an .arp). ApiError 409: the name is taken.
 */
export async function importProfile(
    name: string,
    text: string,
): Promise<ProfileEntry> {
    const res = await request(
        `/api/profiles?name=${encodeURIComponent(name)}`,
        {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: text,
        },
    );
    return res.json();
}

export interface SpotWB {
    temperature: number;
    tint: number;
}

/** The white balance that makes this rectangle (image pixels) neutral. */
export async function spotWB(
    x: number,
    y: number,
    w: number,
    h: number,
): Promise<SpotWB> {
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

/**
 * Start an export (full size, or as large as `size` at most) of the image as it
 * is now (unsaved edits included). Resolves with the job id.
 */
export async function startExport(o: ExportOptions): Promise<string> {
    const res = await request("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(o),
    });
    return ((await res.json()) as { job: string }).job;
}

export async function exportStatus(job: string): Promise<ExportStatus> {
    return (
        await request(`/api/export/${encodeURIComponent(job)}`, {
            cache: "no-store",
        })
    ).json();
}

/** The address of the exported file, to download it. */
export function exportUrl(job: string): string {
    return `/api/export/${encodeURIComponent(job)}/file`;
}

export interface LutEntry {
    id: string;
    /** the path in MART's folder of LUTs, with the extension */
    name: string;
    source: string;
}

export async function listLuts(): Promise<LutEntry[]> {
    return (await request("/api/luts", { cache: "no-store" })).json();
}

/**
 * Store a LUT, a CTL script or a Hald CLUT image from a file of the user's in
 * MART's folder, under this file name. ApiError 409: the name is taken.
 */
export async function importLut(
    fileName: string,
    data: Blob,
): Promise<LutEntry> {
    const res = await request(
        `/api/luts?name=${encodeURIComponent(fileName)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: data,
        },
    );
    return res.json();
}

/** Rename a LUT (its extension stays). ApiError 409: the name is taken. */
export async function renameLut(id: string, name: string): Promise<LutEntry> {
    const res = await request("/api/luts/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
    });
    return res.json();
}

/** Delete a LUT. Resolves with the new list. */
export async function deleteLut(id: string): Promise<LutEntry[]> {
    const res = await request("/api/luts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
    });
    return res.json();
}

/** one parameter of a CTL script, as the engine describes it */
export interface ClutParam {
    name: string;
    type:
        | "int"
        | "float"
        | "bool"
        | "choice"
        | "curve"
        | "flatcurve"
        | "flatcurve_periodic"
        | "huesat";
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

/**
 * The parameters of a LUT: of the one in the profile, or of the one with this
 * id (the host's id from `listLuts`).
 */
export async function lutParams(id?: string): Promise<ClutInfo> {
    const q = id ? `?id=${encodeURIComponent(id)}` : "";
    return (await request(`/api/lut/params${q}`, { cache: "no-store" })).json();
}

/** a section of the parameters, as the Save dialog offers it */
export interface ProfileSection {
    id: string;
    label: string;
    default: boolean;
}

export async function profileSections(): Promise<ProfileSection[]> {
    return (
        await request("/api/profile-sections", { cache: "no-store" })
    ).json();
}

/**
 * Save the current parameters of these sections as a profile of MART. ApiError
 * 409: the name is taken (use `overwrite`).
 */
export async function saveProfile(
    name: string,
    sections: string[],
    overwrite = false,
): Promise<ProfileEntry> {
    const res = await request("/api/profiles/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sections, overwrite }),
    });
    return res.json();
}

/**
 * Choose the profile for images without a sidecar (an id of a profile of MART),
 * or none (null). Resolves with the new list.
 */
export async function setDefaultProfile(
    id: string | null,
): Promise<ProfileEntry[]> {
    const res = await request("/api/profiles/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
    });
    return res.json();
}

/**
 * Rename a profile of MART. ApiError 409: another profile has that name.
 * Resolves with the renamed one.
 */
export async function renameProfile(
    id: string,
    name: string,
): Promise<ProfileEntry> {
    const res = await request("/api/profiles/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
    });
    return res.json();
}

/** Delete a profile of MART. Resolves with the new list. */
export async function deleteProfile(id: string): Promise<ProfileEntry[]> {
    const res = await request("/api/profiles/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
    });
    return res.json();
}
