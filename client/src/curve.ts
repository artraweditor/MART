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

// Geometry of a tone curve (ART's "diagonal curve"): parsing and writing the
// profile's list, the shape drawn
// in the editor, and the edits of its points. No DOM here, so that it can be
// tested.

export type Pt = [number, number];

export interface Curve {
    /**
     * 1 = spline, 4 = flexible (Catmull-Rom); what the profile had, or 1 for a
     * new curve
     */
    type: number;
    /** x strictly increasing within 0..1, first x = 0, last x = 1 */
    pts: Pt[];
}

/** the least distance in x between two points */
export const GAP = 0.01;

export const identity = (): Curve => ({
    type: 1,
    pts: [
        [0, 0],
        [1, 1],
    ],
});

export function isIdentity(c: Curve): boolean {
    return (
        c.pts.length === 2 &&
        c.pts[0]![0] === 0 &&
        c.pts[0]![1] === 0 &&
        c.pts[1]![0] === 1 &&
        c.pts[1]![1] === 1
    );
}

/**
 * The curve held by a profile value (the text `1;0;0;0.5;0.6;1;1;` or a list of
 * numbers), or null when it is
 * of a kind this editor does not handle (parametric, NURBS, a malformed list).
 */
export function parseCurve(v: unknown): Curve | null {
    let nums: number[];
    if (Array.isArray(v)) nums = v.map(Number);
    else if (typeof v === "string")
        nums = v
            .split(";")
            .filter((s) => s.trim() !== "")
            .map(Number);
    else return identity();
    if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) return null;
    if (nums.length === 1) return nums[0] === 0 ? identity() : null;
    const type = nums[0]!;
    if ((type !== 1 && type !== 4) || nums.length < 5 || nums.length % 2 === 0)
        return null;
    const pts: Pt[] = [];
    for (let i = 1; i < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
    for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i]!;
        if (x < 0 || x > 1 || y < 0 || y > 1 || (i > 0 && x <= pts[i - 1]![0]))
            return null;
    }
    // the editor keeps the ends at the edges
    if (pts[0]![0] !== 0 || pts[pts.length - 1]![0] !== 1) return null;
    return { type, pts };
}

/** the list to put in a patch: `[0]` for the identity */
export function encode(c: Curve): number[] {
    if (isIdentity(c)) return [0];
    const out = [c.type];
    for (const [x, y] of c.pts) out.push(round(x), round(y));
    return out;
}

const round = (v: number): number => Math.round(v * 1e5) / 1e5;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * slopes of the natural cubic spline through the points (second derivatives,
 * solved by the Thomas algorithm)
 */
function naturalSecond(p: Pt[]): number[] {
    const n = p.length;
    const y2 = new Array<number>(n).fill(0);
    const u = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
        const sig = (p[i]![0] - p[i - 1]![0]) / (p[i + 1]![0] - p[i - 1]![0]);
        const q = sig * y2[i - 1]! + 2;
        y2[i] = (sig - 1) / q;
        const d =
            (p[i + 1]![1] - p[i]![1]) / (p[i + 1]![0] - p[i]![0]) -
            (p[i]![1] - p[i - 1]![1]) / (p[i]![0] - p[i - 1]![0]);
        u[i] = ((6 * d) / (p[i + 1]![0] - p[i - 1]![0]) - sig * u[i - 1]!) / q;
    }
    for (let k = n - 2; k >= 0; k--) y2[k] = y2[k]! * y2[k + 1]! + u[k]!;
    return y2;
}

/** the value of the curve at x (0..1), clamped to 0..1 */
export function makeEvaluator(c: Curve): (x: number) => number {
    const p = c.pts;
    const n = p.length;
    if (c.type === 4) {
        const m = p.map((_, i) => {
            const a = p[Math.max(0, i - 1)]!;
            const b = p[Math.min(n - 1, i + 1)]!;
            return b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]);
        });
        return (x) => {
            let i = 0;
            while (i < n - 2 && x > p[i + 1]![0]) i++;
            const [x0, y0] = p[i]!;
            const [x1, y1] = p[i + 1]!;
            const h = x1 - x0;
            const t = Math.min(1, Math.max(0, (x - x0) / h));
            const t2 = t * t;
            const t3 = t2 * t;
            return clamp01(
                (2 * t3 - 3 * t2 + 1) * y0 +
                    (t3 - 2 * t2 + t) * h * m[i]! +
                    (-2 * t3 + 3 * t2) * y1 +
                    (t3 - t2) * h * m[i + 1]!,
            );
        };
    }
    const y2 = naturalSecond(p);
    return (x) => {
        let i = 0;
        while (i < n - 2 && x > p[i + 1]![0]) i++;
        const [x0, y0] = p[i]!;
        const [x1, y1] = p[i + 1]!;
        const h = x1 - x0;
        const a = (x1 - x) / h;
        const b = (x - x0) / h;
        return clamp01(
            a * y0 +
                b * y1 +
                (((a * a * a - a) * y2[i]! + (b * b * b - b) * y2[i + 1]!) *
                    (h * h)) /
                    6,
        );
    };
}

/**
 * point `i` moved to (x, y): the ends keep their x, the others stay between
 * their neighbours
 */
export function movePoint(pts: Pt[], i: number, x: number, y: number): Pt[] {
    const out = pts.map((p) => [...p] as Pt);
    const last = pts.length - 1;
    out[i]![1] = clamp01(y);
    if (i > 0 && i < last)
        out[i]![0] = Math.min(
            pts[i + 1]![0] - GAP,
            Math.max(pts[i - 1]![0] + GAP, x),
        );
    return out;
}

/**
 * a point added at (x, y), unless one is too close in x; `index` is where it
 * went (or of the near point)
 */
export function addPoint(
    pts: Pt[],
    x: number,
    y: number,
): { pts: Pt[]; index: number } {
    const near = pts.findIndex((p) => Math.abs(p[0] - x) < GAP);
    if (near >= 0) return { pts, index: near };
    let i = 0;
    while (i < pts.length && pts[i]![0] < x) i++;
    const out = pts.map((p) => [...p] as Pt);
    out.splice(i, 0, [x, clamp01(y)]);
    return { pts: out, index: i };
}

/** the points without point `i`; the two ends stay */
export function removePoint(pts: Pt[], i: number): Pt[] {
    if (i <= 0 || i >= pts.length - 1) return pts;
    return pts.filter((_, j) => j !== i);
}

/**
 * the index of the point within `radius` of (x, y), the nearest, or -1 (all in
 * the same unit)
 */
export function hitPoint(
    pts: Pt[],
    x: number,
    y: number,
    radius: number,
): number {
    let best = -1;
    let bd = radius;
    pts.forEach((p, i) => {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d <= bd) {
            bd = d;
            best = i;
        }
    });
    return best;
}
