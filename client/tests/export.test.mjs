import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatElapsed, toOptions } from "../dist/app/exportsheet.js";

const saved = { format: "jpg", quality: 92, pngBits: 8, tifBits: 16, compression: "none", size: 0 };

test("only the options of the chosen format are sent", () => {
    assert.deepEqual(toOptions(saved, ""), { format: "jpg", quality: 92 });
    assert.deepEqual(toOptions({ ...saved, size: 2560 }, ""), { format: "jpg", quality: 92, size: 2560 });
    assert.deepEqual(toOptions({ ...saved, format: "png", pngBits: 16 }, ""), { format: "png", bits: 16 });
    assert.deepEqual(toOptions({ ...saved, format: "tif", tifBits: 32, compression: "zip" }, ""), { format: "tif", bits: 32, compression: "zip" });
});

test("a size is sent only when the image is resized", () => {
    assert.equal("size" in toOptions(saved, ""), false);
    assert.equal("size" in toOptions({ ...saved, size: undefined }, ""), false, "an old saved choice has no size");
    assert.deepEqual(toOptions({ ...saved, size: 1920 }, ""), { format: "jpg", quality: 92, size: 1920 });
    assert.deepEqual(toOptions({ ...saved, format: "png", pngBits: 16, size: 3840 }, "x"), { format: "png", bits: 16, size: 3840, name: "x" });
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
