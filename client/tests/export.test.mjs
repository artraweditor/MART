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
    formatBytes,
    formatElapsed,
    toOptions,
} from "../dist/app/exportsheet.js";

const saved = {
    format: "jpg",
    quality: 92,
    pngBits: 8,
    tifBits: 16,
    compression: "none",
    size: 0,
};

test("only the options of the chosen format are sent", () => {
    assert.deepEqual(toOptions(saved, ""), { format: "jpg", quality: 92 });
    assert.deepEqual(toOptions({ ...saved, size: 2560 }, ""), {
        format: "jpg",
        quality: 92,
        size: 2560,
    });
    assert.deepEqual(toOptions({ ...saved, format: "png", pngBits: 16 }, ""), {
        format: "png",
        bits: 16,
    });
    assert.deepEqual(
        toOptions(
            { ...saved, format: "tif", tifBits: 32, compression: "zip" },
            "",
        ),
        { format: "tif", bits: 32, compression: "zip" },
    );
});

test("a size is sent only when the image is resized", () => {
    assert.equal("size" in toOptions(saved, ""), false);
    assert.equal(
        "size" in toOptions({ ...saved, size: undefined }, ""),
        false,
        "an old saved choice has no size",
    );
    assert.deepEqual(toOptions({ ...saved, size: 1920 }, ""), {
        format: "jpg",
        quality: 92,
        size: 1920,
    });
    assert.deepEqual(
        toOptions({ ...saved, format: "png", pngBits: 16, size: 3840 }, "x"),
        { format: "png", bits: 16, size: 3840, name: "x" },
    );
});

test("a typed name is sent, blanks are not", () => {
    assert.equal(toOptions(saved, "  holiday 1  ").name, "holiday 1");
    assert.equal("name" in toOptions(saved, "   "), false);
});

test("sizes and times for people", () => {
    assert.equal(formatBytes(310_000), "310 kB");
    assert.equal(formatBytes(1), "1 kB");
    assert.equal(formatBytes(2_450_000), "2.5 MB");
    assert.equal(formatElapsed(900), "1 s");
    assert.equal(formatElapsed(42_000), "42 s");
    assert.equal(formatElapsed(125_000), "2 min 5 s");
});
