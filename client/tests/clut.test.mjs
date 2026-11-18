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
    parseClutParams,
    withDefaults,
    lutName,
    isLutId,
    matchLut,
    paramDefs,
    presetsDef,
    lutDef,
} from "../dist/app/clut.js";
import { patchFor, readValue } from "../dist/app/tools.js";

const info = {
    params: [
        {
            name: "gain",
            type: "float",
            label: "Gain",
            group: "",
            tooltip: "",
            min: -1,
            max: 1,
            step: 0.1,
            default: [0.5],
        },
        {
            name: "steps",
            type: "int",
            label: "Steps",
            group: "",
            tooltip: "",
            min: 1,
            max: 10,
            step: 1,
            default: [3],
        },
        {
            name: "inv",
            type: "bool",
            label: "Invert",
            group: "",
            tooltip: "",
            min: 0,
            max: 1,
            step: 1,
            default: [1],
        },
        {
            name: "mode",
            type: "choice",
            label: "Mode",
            group: "",
            tooltip: "",
            min: 0,
            max: 1,
            step: 1,
            default: [1],
            choices: [
                { label: "A", value: 0 },
                { label: "B", value: 1 },
            ],
        },
        {
            name: "tint",
            type: "huesat",
            label: "Tint",
            group: "Color",
            tooltip: "",
            min: 0,
            max: 1,
            step: 0.01,
            default: [0, 0.2],
        },
        {
            name: "curve",
            type: "curve",
            label: "Curve",
            group: "Color",
            tooltip: "",
            min: 0,
            max: 1,
            step: 0.01,
            default: [0],
        },
    ],
    presets: [
        { key: "warm", label: "Warm", values: { gain: [0.8], steps: [5] } },
    ],
};
const get = (text) => (g, k) =>
    g === "Film Simulation" && k === "ClutParams" ? text : undefined;
const by = (defs, label) => defs.find((d) => d.label === label);

test("ClutParams: the profile's text and the object of a patch", () => {
    assert.deepEqual(parseClutParams("gain=0.900000;hs=1.5,0.25;"), {
        gain: [0.9],
        hs: [1.5, 0.25],
    });
    assert.deepEqual(parseClutParams(""), {});
    assert.deepEqual(parseClutParams(undefined), {});
    assert.deepEqual(parseClutParams("junk;=1;a=x;"), {});
    assert.deepEqual(parseClutParams({ a: [1, 2] }), { a: [1, 2] });
});

test("defaults fill what the profile does not say", () => {
    assert.deepEqual(withDefaults(info, { gain: [0.1] }), {
        gain: [0.1],
        steps: [3],
        inv: [1],
        mode: [1],
        tint: [0, 0.2],
        curve: [0],
    });
});

test("the name of a LUT", () => {
    assert.equal(lutName("file:///tmp/a%20b/film%20one.cube"), "film one.cube");
    assert.equal(lutName("/home/x/y.ctl"), "y.ctl");
    assert.equal(lutName("u3", { id: "u3", name: "mine.png" }), "mine.png");
    assert.equal(lutName(""), "");
    assert.equal(isLutId("u3"), true);
    assert.equal(isLutId("d0:sub/a.ctl"), true);
    assert.equal(isLutId("file:///x"), false);
});

test("controls for the parameters of a script", () => {
    const defs = paramDefs(info);
    assert.deepEqual(
        defs.map((d) => [d.kind, d.label]),
        [
            ["slider", "Gain"],
            ["slider", "Steps"],
            ["toggle", "Invert"],
            ["choice", "Mode"],
            ["heading", "Color"],
            ["slider", "Tint: hue"],
            ["slider", "Tint: saturation"],
            ["heading", "Curve: a curve, edit it in ART"],
        ],
    );
    const gain = by(defs, "Gain");
    assert.deepEqual(
        [gain.min, gain.max, gain.step, gain.def, gain.digits],
        [-1, 1, 0.1, 0.5, 1],
    );
    assert.equal(by(defs, "Steps").digits, 0);
});

test("a slider writes every parameter, with the others as they are", () => {
    const defs = paramDefs(info);
    const p = patchFor(by(defs, "Gain"), 0.9, get("steps=7.000000;"));
    assert.deepEqual(p["Film Simulation"], {
        Enabled: true,
        ClutParams: {
            gain: [0.9],
            steps: [7],
            inv: [1],
            mode: [1],
            tint: [0, 0.2],
            curve: [0],
        },
    });
    // an int is an int
    assert.deepEqual(patchFor(by(defs, "Steps"), 4.4, get("")), {
        "Film Simulation": {
            Enabled: true,
            ClutParams: {
                gain: [0.5],
                steps: [4],
                inv: [1],
                mode: [1],
                tint: [0, 0.2],
                curve: [0],
            },
        },
    });
    // after a patch the profile holds an object, not text
    assert.equal(
        patchFor(by(defs, "Gain"), 0.1, get({ steps: [2] }))["Film Simulation"]
            .ClutParams.steps[0],
        2,
    );
});

test("reading: the profile's value, else the default", () => {
    const defs = paramDefs(info);
    const params = {
        "Film Simulation": { ClutParams: "gain=-0.300000;inv=0.000000;" },
    };
    assert.equal(readValue(params, by(defs, "Gain")), -0.3);
    assert.equal(readValue({}, by(defs, "Gain")), 0.5);
    assert.equal(readValue(params, by(defs, "Invert")), false);
    assert.equal(readValue({}, by(defs, "Invert")), true);
    assert.equal(readValue(params, by(defs, "Mode")), 1);
});

test("a bool is written as 0 or 1, a choice as its number", () => {
    const defs = paramDefs(info);
    assert.deepEqual(
        patchFor(by(defs, "Invert"), false, get(""))["Film Simulation"]
            .ClutParams.inv,
        [0],
    );
    assert.deepEqual(
        patchFor(by(defs, "Mode"), 0, get(""))["Film Simulation"].ClutParams
            .mode,
        [0],
    );
});

test("hue and saturation: the hue is shown in degrees", () => {
    const defs = paramDefs(info);
    const hue = by(defs, "Tint: hue");
    const p = patchFor(hue, 90, get("tint=0.000000,0.500000;"))[
        "Film Simulation"
    ].ClutParams.tint;
    assert.ok(Math.abs(p[0] - Math.PI / 2) < 1e-9 && p[1] === 0.5);
    assert.ok(
        Math.abs(
            readValue(
                { "Film Simulation": { ClutParams: "tint=3.141593,0.5;" } },
                hue,
            ) - 180,
        ) < 1e-4,
    );
    assert.deepEqual(
        patchFor(by(defs, "Tint: saturation"), 0.7, get(""))["Film Simulation"]
            .ClutParams.tint,
        [0, 0.7],
    );
});

test("presets and reset", () => {
    const d = presetsDef(info);
    assert.deepEqual(
        d.options.map((o) => o.label),
        ["Warm", "Reset"],
    );
    assert.deepEqual(
        patchFor(d, "warm", get(""))["Film Simulation"].ClutParams,
        {
            gain: [0.8],
            steps: [5],
            inv: [1],
            mode: [1],
            tint: [0, 0.2],
            curve: [0],
        },
    );
    assert.deepEqual(
        patchFor(d, "", get("gain=1;"))["Film Simulation"].ClutParams,
        {},
    );
    assert.equal(presetsDef({ params: [], presets: [] }), null);
});

test(
    "choosing a LUT starts from its defaults and turns the tool on; none " +
        "turns it off",
    () => {
        assert.deepEqual(patchFor(lutDef, "u2", get("gain=1;")), {
            "Film Simulation": {
                Enabled: true,
                ClutFilename: "u2",
                ClutParams: {},
            },
        });
        assert.deepEqual(patchFor(lutDef, "", get("")), {
            "Film Simulation": {
                Enabled: false,
                ClutFilename: "",
                ClutParams: {},
            },
        });
    },
);

test("which LUT of MART's folder a profile means", () => {
    const luts = [
        { id: "d0:a.cube", name: "a.cube", source: "mine" },
        { id: "d0:grade.ctl", name: "grade.ctl", source: "mine" },
        { id: "d0:sub/grade.ctl", name: "sub/grade.ctl", source: "mine" },
        { id: "d0:my film.png", name: "my film.png", source: "mine" },
    ];
    const m = (k) => matchLut(k, luts)?.id ?? null;
    // the id just chosen
    assert.equal(m("d0:a.cube"), "d0:a.cube");
    // what a profile or the engine says: the host R is relative to the folder
    assert.equal(m("file://R/a.cube"), "d0:a.cube");
    assert.equal(m("file://R/my%20film.png"), "d0:my film.png");
    assert.equal(
        m("file://R/sub/grade.ctl"),
        "d0:sub/grade.ctl",
        "the longest path that matches",
    );
    assert.equal(m("file://R/grade.ctl"), "d0:grade.ctl");
    // an absolute path or the URI of one, in the folder wherever it is
    assert.equal(
        m("file:///home/x/.config/MART/luts/grade.ctl"),
        "d0:grade.ctl",
    );
    assert.equal(
        m("file://H/.config/MART/luts/sub/grade.ctl"),
        "d0:sub/grade.ctl",
    );
    assert.equal(m("/tmp/luts/my film.png"), "d0:my film.png");
    assert.equal(m("sub/grade.ctl"), "d0:sub/grade.ctl");
    // none of them
    assert.equal(m("file:///somewhere/else.cube"), null);
    assert.equal(
        m("file:///x/notgrade.ctl"),
        null,
        "a name that only ends the same",
    );
    assert.equal(m(""), null);
    assert.equal(m(undefined), null);
});
