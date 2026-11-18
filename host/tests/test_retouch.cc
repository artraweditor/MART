// Unit tests of the retouching regions. SPDX-License-Identifier: GPL-3.0-or-later
#include "../src/retouch.h"
#include <cmath>
#include <iostream>

using namespace mart::retouch;
using json = nlohmann::json;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { ++failures; std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #c "\n"; } } while (0)

static bool refused(const std::string &text, const json &change)
{
    try { rewrite(text, change); } catch (const std::invalid_argument &) { return true; }
    return false;
}
static bool has(const std::string &text, const std::string &line) { return text.find("\n" + line + "\n") != std::string::npos; }

int main()
{
    // strokes: what is written reads back (to the precision of a half float), long strokes are split
    {
        json g = json::array({json::array({0.1, 1, 1.0, 0.25, 0.5, 0.3, 0.5}), json::array({0.05, 0, 0.5, 0.75, 0.25})});
        json back = unpackStrokes(packStrokes(g));
        CHECK(back.size() == 2 && back[0].size() == 7 && back[1].size() == 5);
        CHECK(std::fabs(back[0][0].get<double>() - 0.1) < 1e-3 && back[0][1] == 1 && back[1][1] == 0);
        CHECK(std::fabs(back[0][3].get<double>() - 0.25) < 1e-3 && std::fabs(back[1][4].get<double>() - 0.25) < 1e-3);
        // the value of the python example in the ART documentation: a half float list [-100,-100,0, 100,-100,0, 0,0,0]
        json one = json::array({json::array({0.5, 1, 1, 0.5, 0.8, 0.55, 0.8, 0.6, 0.8})});
        CHECK(unpackStrokes(packStrokes(one)).at(0).size() == 9);
        json many = json::array({json::array({0.1, 1, 1})});
        for (int i = 0; i < 5000; ++i) { many[0].push_back(0.5); many[0].push_back(0.5); }
        json big = unpackStrokes(packStrokes(many));
        CHECK(big.size() == 3);  // 2048 + 2048 + 904 dabs
        CHECK(big[0].size() == 3 + 2 * 2048 && big[2].size() == 3 + 2 * 904);
        CHECK(unpackStrokes("").empty());
    }
    // a sidecar with one region of the tool, which is on
    const std::string on = "[Exposure]\nEnabled=true\n\n[ColorCorrection]\nEnabled=true\nMode_1=YUV\nSlope_1=0.9\nMaskName_1=sky\n"
                           "MaskEnabled_1=true\nSelectedRegion=0\nShowMask=-1\n\n[Grain]\nEnabled=false\n";
    std::string off = on;
    off.replace(off.find("Enabled=true\nMode_1"), 12, "Enabled=false");

    CHECK(state(on) == json::object());
    CHECK(!present(on));

    // adding a region: after the sidecar's, which stays as it is; only the ColorCorrection group is written
    std::string t = rewrite(on, {{"3", {{"Enabled", true}, {"HueShift", 20}, {"Slope", 1.5}}}});
    CHECK(t.compare(0, 18, "[ColorCorrection]\n") == 0 && t.find("[Exposure]") == std::string::npos && t.find("[Grain]") == std::string::npos);
    CHECK(has("\n" + t, "Mode_1=YUV") && has("\n" + t, "Slope_1=0.9") && has("\n" + t, "MaskName_1=sky"));
    CHECK(has("\n" + t, "Mode_2=Jzazbz") && has("\n" + t, "MaskName_2=MART retouch 3") && has("\n" + t, "MaskEnabled_2=true") &&
          has("\n" + t, "HueShift_2=20") && has("\n" + t, "Slope_2=1.5") && has("\n" + t, "Enabled=true"));
    CHECK(present(t));
    json s = state(t);
    CHECK(s.size() == 1 && s["3"]["Enabled"] == true && s["3"]["HueShift"] == 20 && s["3"]["Slope"] == 1.5 && s["3"]["Power"] == 1);
    CHECK(s["3"]["BrushEnabled"] == false && s["3"]["Strokes"].empty());

    // editing it changes it in place; a second region goes after it; the brush and its keys
    t = rewrite(t, {{"3", {{"Enabled", true}, {"BrushEnabled", true}, {"BrushOpacity", 80}, {"BrushFeather", 12.5}, {"BrushSmoothness", 30},
                            {"Strokes", json::array({json::array({0.1, 1, 1.0, 0.5, 0.5, 0.6, 0.5})})}}},
                    {"7", {{"Enabled", true}, {"Offset", 0.05}}}});
    CHECK(!has("\n" + t, "Mode_4=Jzazbz") && has("\n" + t, "MaskName_3=MART retouch 7") && has("\n" + t, "Offset_3=0.05"));
    CHECK(has("\n" + t, "DrawnMaskEnabled_2=true") && has("\n" + t, "DrawnMaskMode_2=0") && has("\n" + t, "DrawnMaskOpacity_2=0.8") &&
          has("\n" + t, "DrawnMaskFeather_2=12.5") && has("\n" + t, "DrawnMaskSmoothness_2=0.3"));
    s = state(t);
    CHECK(s.size() == 2 && s["3"]["BrushEnabled"] == true && s["3"]["BrushOpacity"] == 80 && s["3"]["BrushSmoothness"] == 30);
    CHECK(s["3"]["Strokes"].size() == 1 && s["3"]["Strokes"][0].size() == 7);

    // removing one renumbers the others, and the sidecar's region is untouched
    std::string r = rewrite(t, {{"3", nullptr}});
    CHECK(has("\n" + r, "MaskName_1=sky") && has("\n" + r, "MaskName_2=MART retouch 7") && !has("\n" + r, "MaskName_3=MART retouch 7"));
    CHECK(state(r).size() == 1 && state(r).contains("7"));
    // removing the last of ours leaves the tool on for the sidecar's region
    CHECK(has("\n" + rewrite(rewrite(on, {{"1", {{"Enabled", true}}}}), {{"1", nullptr}}), "Enabled=true"));

    // the tool was off: turning a region on turns it on, and the sidecar's region stays off with it
    t = rewrite(off, {{"1", {{"Enabled", true}}}});
    CHECK(has("\n" + t, "Enabled=true") && has("\n" + t, "MaskEnabled_1=false") && has("\n" + t, "MaskEnabled_2=true"));
    // regions of ours are off as the tool is, whatever their own switch says
    json so = state(rewrite(off, {{"1", {{"HueShift", 5}}}}));
    CHECK(so["1"]["Enabled"] == false && so["1"]["HueShift"] == 5);
    // turning off the last region that is on turns the tool off; with another on it stays
    t = rewrite(rewrite(off, {{"1", {{"Enabled", true}}}}), {{"1", {{"Enabled", false}}}});
    CHECK(has("\n" + t, "Enabled=false"));
    t = rewrite(on, {{"1", {{"Enabled", true}}}});
    CHECK(has("\n" + rewrite(t, {{"1", {{"Enabled", false}}}}), "Enabled=true"));

    // bad changes
    CHECK(refused(on, json::array()));
    CHECK(refused(on, {{"0", {{"Slope", 1}}}}));
    CHECK(refused(on, {{"x", {{"Slope", 1}}}}));
    CHECK(refused(on, {{"1", {{"Slope", 100}}}}));
    CHECK(refused(on, {{"1", {{"Wheel", 1}}}}));
    CHECK(refused(on, {{"1", {{"Enabled", 1}}}}));
    CHECK(refused(on, {{"1", {{"Strokes", json::array({json::array({0.1, 1, 1, 7, 7})})}}}}));
    CHECK(refused(on, {{"1", {{"Strokes", json::array({json::array({0.1, 2, 1, 0.5, 0.5})})}}}}));
    CHECK(refused(on, {{"1", 5}}));

    // saving: only our regions, numbered from 1, off if the tool is
    t = rewrite(on, {{"3", {{"Enabled", true}, {"HueShift", 20}}}, {"4", {{"Enabled", true}, {"Power", 2}}}});
    std::string p = profileText(t);
    CHECK(p.compare(0, 18, "[ColorCorrection]\n") == 0 && has("\n" + p, "MaskName_1=MART retouch 3") && has("\n" + p, "MaskName_2=MART retouch 4"));
    CHECK(p.find("sky") == std::string::npos && has("\n" + p, "MaskEnabled_1=true"));
    CHECK(profileText(on).empty());
    std::string pOff = profileText(rewrite(off, {{"1", {{"HueShift", 5}}}}));
    CHECK(has("\n" + pOff, "MaskEnabled_1=false"));

    // applying a profile: the image's own regions are kept, ours are replaced by the profile's
    std::string image = rewrite(t, {{"9", {{"Enabled", true}, {"Slope", 2}}}});  // ours: 3, 4, 9
    std::string q = replace(image, p);
    CHECK(has("\n" + q, "MaskName_1=sky") && has("\n" + q, "MaskName_2=MART retouch 3") && has("\n" + q, "MaskName_3=MART retouch 4"));
    CHECK(!has("\n" + q, "MaskName_4=MART retouch 9") && state(q).size() == 2);
    // the image's tool is off: the profile's regions turn it on and the image's own stay off
    q = replace(off, p);
    CHECK(has("\n" + q, "Enabled=true") && has("\n" + q, "MaskEnabled_1=false") && has("\n" + q, "MaskEnabled_2=true"));
    CHECK(withoutColorCorrection(p + "[Grain]\nEnabled=true\n").find("Retouch") == std::string::npos);
    CHECK(withoutColorCorrection("[Exposure]\nEnabled=true\n\n" + p + "[Grain]\nEnabled=true\n").find("[Grain]") != std::string::npos);

    if (failures) return 1;
    std::cout << "retouch tests: ok\n";
    return 0;
}
