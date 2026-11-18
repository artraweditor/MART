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

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseCurve,
    encode,
    identity,
    makeEvaluator,
    movePoint,
    addPoint,
    removePoint,
    hitPoint,
    GAP,
} from "../dist/app/curve.js";

test("the identity is `0;`", () => {
    assert.deepEqual(parseCurve("0;"), identity());
    assert.deepEqual(parseCurve(undefined), identity());
    assert.deepEqual(encode(identity()), [0]);
});

test("parse and encode round trip", () => {
    const c = parseCurve("1;0;0;0.5;0.6;1;1;");
    assert.deepEqual(c, {
        type: 1,
        pts: [
            [0, 0],
            [0.5, 0.6],
            [1, 1],
        ],
    });
    assert.deepEqual(encode(c), [1, 0, 0, 0.5, 0.6, 1, 1]);
    assert.equal(parseCurve("4;0;0.05;0.5;0.5;1;0.97;").type, 4);
});

test("curves of other kinds or malformed ones are not edited", () => {
    assert.equal(parseCurve("2;0;0;1;1;"), null); // parametric
    assert.equal(parseCurve("3;0;0;1;1;"), null); // NURBS
    assert.equal(parseCurve("1;0;0;1;"), null); // even length
    // x not increasing
    assert.equal(parseCurve("1;0;0;0.5;0.5;0.5;0.7;1;1;"), null);
    assert.equal(parseCurve("1;0.1;0;1;1;"), null); // does not start at 0
    assert.equal(parseCurve("1;0;0;1.5;1;"), null);
    assert.equal(parseCurve("x;y"), null);
});

test("the splines pass through the points and stay in range", () => {
    for (const type of [1, 4]) {
        const c = {
            type,
            pts: [
                [0, 0],
                [0.25, 0.1],
                [0.75, 0.95],
                [1, 1],
            ],
        };
        const f = makeEvaluator(c);
        for (const [x, y] of c.pts)
            assert.ok(Math.abs(f(x) - y) < 1e-9, `type ${type} at ${x}`);
        for (let x = 0; x <= 1; x += 0.01) assert.ok(f(x) >= 0 && f(x) <= 1);
    }
    const f = makeEvaluator(identity());
    for (let x = 0; x <= 1; x += 0.1) assert.ok(Math.abs(f(x) - x) < 1e-9);
});

test(
    "movePoint: the ends keep their x, the " + "others stay between neighbours",
    () => {
        const pts = [
            [0, 0],
            [0.5, 0.5],
            [1, 1],
        ];
        assert.deepEqual(movePoint(pts, 0, 0.3, 0.2), [
            [0, 0.2],
            [0.5, 0.5],
            [1, 1],
        ]);
        assert.deepEqual(movePoint(pts, 1, 2, 3), [
            [0, 0],
            [1 - GAP, 1],
            [1, 1],
        ]);
        assert.deepEqual(movePoint(pts, 1, -1, -1), [
            [0, 0],
            [GAP, 0],
            [1, 1],
        ]);
        assert.deepEqual(pts[1], [0.5, 0.5], "the input is not changed");
    },
);

test("addPoint, removePoint, hitPoint", () => {
    const a = addPoint(
        [
            [0, 0],
            [1, 1],
        ],
        0.4,
        0.3,
    );
    assert.deepEqual(a, {
        pts: [
            [0, 0],
            [0.4, 0.3],
            [1, 1],
        ],
        index: 1,
    });
    assert.equal(
        addPoint(a.pts, 0.405, 0.9).index,
        1,
        "too close: the near point",
    );
    assert.equal(addPoint(a.pts, 0.405, 0.9).pts.length, 3);
    assert.deepEqual(removePoint(a.pts, 1), [
        [0, 0],
        [1, 1],
    ]);
    assert.equal(removePoint(a.pts, 0).length, 3, "the ends stay");
    assert.equal(hitPoint(a.pts, 0.41, 0.31, 0.05), 1);
    assert.equal(hitPoint(a.pts, 0.7, 0.7, 0.05), -1);
});
