// Unit tests of the export requests. SPDX-License-Identifier: GPL-3.0-or-later
#include "../src/exportreq.h"
#include <iostream>

using namespace mart;
using nlohmann::json;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { ++failures; std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #c "\n"; } } while (0)

static bool refused(const json &body)
{
    try { parseExportRequest(body, "photo"); } catch (const ExportRequestError &) { return true; }
    return false;
}
static std::vector<std::string> args(const json &body) { return exportArgs(parseExportRequest(body, "photo"), "/out/x." + body.value("format", "jpg")); }
using V = std::vector<std::string>;

int main()
{
    CHECK(args(json::object()) == (V{"export", "/out/x.jpg", "--format", "jpg", "--quality", "92"}));
    CHECK(args({{"format", "jpg"}, {"quality", 70}}) == (V{"export", "/out/x.jpg", "--format", "jpg", "--quality", "70"}));
    CHECK(args({{"format", "png"}, {"bits", 16}}) == (V{"export", "/out/x.png", "--format", "png", "--bits", "16"}));
    CHECK(args({{"format", "png"}}) == (V{"export", "/out/x.png", "--format", "png"}));
    CHECK(args({{"format", "tif"}, {"bits", 16}, {"float", true}, {"compression", "zip"}}) ==
          (V{"export", "/out/x.tif", "--format", "tif", "--bits", "16", "--float", "--compression", "zip"}));
    CHECK(args({{"format", "tif"}, {"bits", 32}}) == (V{"export", "/out/x.tif", "--format", "tif", "--bits", "32"}));

    // what does not apply, or is out of range, is refused here with a clear message
    CHECK(refused(json::array()));
    CHECK(refused({{"format", "gif"}}));
    CHECK(refused({{"format", 3}}));
    CHECK(refused({{"quality", 0}}));
    CHECK(refused({{"quality", 101}}));
    CHECK(refused({{"quality", 50.5}}));
    CHECK(refused({{"quality", "50"}}));
    CHECK(refused({{"format", "png"}, {"quality", 50}}));
    CHECK(refused({{"format", "jpg"}, {"bits", 8}}));
    CHECK(refused({{"format", "png"}, {"bits", 32}}));
    CHECK(refused({{"format", "tif"}, {"bits", 12}}));
    CHECK(refused({{"format", "tif"}, {"bits", 8}, {"float", true}}));
    CHECK(refused({{"format", "png"}, {"float", true}}));
    CHECK(refused({{"format", "png"}, {"compression", "zip"}}));
    CHECK(refused({{"format", "tif"}, {"compression", "lzw"}}));
    CHECK(refused({{"overwrite", true}}));      // never up to the client
    CHECK(refused({{"fast", true}}));
    CHECK(refused({{"name", 5}}));

    // names
    CHECK(parseExportRequest(json::object(), "IMG_0001").stem == "IMG_0001");
    CHECK(parseExportRequest({{"name", "My shot (final).JPG"}}, "x").stem == "My shot (final)");
    CHECK(parseExportRequest({{"name", "../../etc/passwd"}}, "x").stem == "_.._etc_passwd");
    CHECK(parseExportRequest({{"name", "a/b\\c"}}, "x").stem == "a_b_c");
    CHECK(parseExportRequest({{"name", "..."}}, "photo").stem == "photo");   // nothing usable: the default
    CHECK(parseExportRequest({{"name", ""}}, "photo").stem == "photo");
    CHECK(parseExportRequest({{"name", "  .hidden  "}}, "photo").stem == "hidden");
    CHECK(parseExportRequest({{"name", "a\nb\tc"}}, "x").stem == "a_b_c");     // no control characters
    CHECK(parseExportRequest(json::object(), "").stem == "export");
    CHECK(parseExportRequest({{"name", std::string(500, 'a')}}, "x").stem.size() <= 120);
    CHECK(sanitizeStem("caf\xc3\xa9") == "caf\xc3\xa9");                            // UTF-8 passes
    CHECK(exportMimeType("jpg") == "image/jpeg" && exportMimeType("tif") == "image/tiff" && exportMimeType("png") == "image/png");

    if (failures) return 1;
    std::cout << "test_export: ok\n";
    return 0;
}
