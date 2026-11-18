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
    DENOISE_PRESETS,
    denoiseValue,
    TOOLS,
    patchFor,
    readValue,
} from "../dist/app/tools.js";
import { summarize } from "../dist/app/other.js";

const def = TOOLS.flatMap((t) => t.controls).find(
    (c) => c.kind === "choice" && c.group === "Denoise",
);
const get = () => undefined;

test("each preset is recognised, and off is a disabled tool", () => {
    for (const [name, p] of Object.entries(DENOISE_PRESETS))
        assert.equal(denoiseValue({ Enabled: true, ...p }), name);
    assert.equal(
        denoiseValue({ Enabled: false, ...DENOISE_PRESETS.high }),
        "off",
    );
    assert.equal(denoiseValue(undefined), "off");
    assert.equal(
        denoiseValue({ Enabled: true, ...DENOISE_PRESETS.high, Luminance: 31 }),
        "custom",
    );
});

test("choosing a preset writes all its keys, off only the switch", () => {
    assert.deepEqual(patchFor(def, "off", get), {
        Denoise: { Enabled: false },
    });
    const p = patchFor(def, "medium", get).Denoise;
    assert.equal(p.Enabled, true);
    assert.equal(p.Luminance, 15);
    assert.equal(p.SmoothingEnabled, true);
    assert.equal(
        readValue({ Denoise: { Enabled: true, ...DENOISE_PRESETS.low } }, def),
        "low",
    );
});

test("the Other tab lists a denoise only when it is not a preset", () => {
    assert.equal(
        summarize({ Denoise: { Enabled: true, ...DENOISE_PRESETS.high } })
            .length,
        0,
    );
    assert.equal(
        summarize({
            Denoise: { Enabled: true, ...DENOISE_PRESETS.high, Chrominance: 3 },
        }).length,
        0,
    );
    assert.equal(
        summarize({ Denoise: { Enabled: true, Luminance: 12 } }).length,
        1,
    );
});
