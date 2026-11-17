// Unit tests of the patch serialiser. SPDX-License-Identifier: GPL-3.0-or-later
#include "../src/arp.h"
#include <fstream>
#include <iostream>

using namespace mart::arp;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { ++failures; std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #c "\n"; } } while (0)

static bool refused(const json &patch)
{
    try { serialize(patch); } catch (const PatchError &) { return true; }
    return false;
}

int main()
{
    CHECK(serialize({{"Exposure", {{"Enabled", true}, {"Compensation", 0.5}}}}) ==
          "[Exposure]\nCompensation=0.5\nEnabled=true\n\n");  // keys come out sorted
    // integers are written as integers, even when the client sends 5170.0
    CHECK(serialize({{"White Balance", {{"Temperature", 5170.0}}}}) == "[White Balance]\nTemperature=5170\n\n");
    CHECK(refused({{"White Balance", {{"Temperature", 5170.5}}}}));
    CHECK(serialize({{"ToneCurve", {{"Curve", {1, 0, 0, 0.5, 0.6, 1, 1}}}}}) == "[ToneCurve]\nCurve=1;0;0;0.5;0.6;1;1;\n\n");
    CHECK(serialize({{"ToneCurve", {{"Curve", {0}}}}}) == "[ToneCurve]\nCurve=0;\n\n");

    // geometry
    CHECK(serialize({{"Crop", {{"Enabled", true}, {"X", 10}, {"Y", 20}, {"W", 300}, {"H", 200}, {"FixedRatio", true}, {"Ratio", "3:2"}, {"Orientation", "Landscape"}}}}) ==
          "[Crop]\nEnabled=true\nFixedRatio=true\nH=200\nOrientation=Landscape\nRatio=3:2\nW=300\nX=10\nY=20\n\n");
    CHECK(serialize({{"Rotation", {{"Enabled", true}, {"Degree", -3.25}}}}) == "[Rotation]\nDegree=-3.25\nEnabled=true\n\n");
    CHECK(serialize({{"Coarse Transformation", {{"Rotate", 90}, {"HorizontalFlip", false}}}}) == "[Coarse Transformation]\nHorizontalFlip=false\nRotate=90\n\n");
    CHECK(refused({{"Coarse Transformation", {{"Rotate", 45}}}}));
    CHECK(refused({{"Coarse Transformation", {{"Rotate", "90"}}}}));
    CHECK(refused({{"Coarse Transformation", {{"Rotate", 90.5}}}}));
    CHECK(refused({{"Rotation", {{"Degree", 46}}}}));
    CHECK(refused({{"Crop", {{"W", 1.5}}}}));
    CHECK(refused({{"Crop", {{"Ratio", "7:3"}}}}));
    CHECK(refused({{"Crop", {{"Guide", "Grid"}}}}));

    // the other tools
    CHECK(serialize({{"ToneEqualizer", {{"Enabled", true}, {"Band1", 35}, {"Pivot", -1.5}, {"Regularization", 4}}}}) ==
          "[ToneEqualizer]\nBand1=35\nEnabled=true\nPivot=-1.5\nRegularization=4\n\n");
    CHECK(refused({{"ToneEqualizer", {{"Band0", 101}}}}));
    CHECK(refused({{"ToneEqualizer", {{"Regularization", 5}}}}));
    CHECK(serialize({{"Channel Mixer", {{"Mode", 1}, {"SatTweak", {0, 30, 0}}}}}) == "[Channel Mixer]\nMode=1\nSatTweak=0;30;0;\n\n");
    CHECK(serialize({{"Channel Mixer", {{"HueTweak", {-10, 0, 20}}}}}) == "[Channel Mixer]\nHueTweak=-10;0;20;\n\n");
    CHECK(refused({{"Channel Mixer", {{"HueTweak", {10, 0}}}}}));         // three values
    CHECK(refused({{"Channel Mixer", {{"HueTweak", {10, 0, 0.5}}}}}));    // integers
    CHECK(refused({{"Channel Mixer", {{"HueTweak", {101, 0, 0}}}}}));     // range
    CHECK(refused({{"Channel Mixer", {{"HueTweak", "10;0;0;"}}}}));       // not a list
    CHECK(refused({{"Channel Mixer", {{"Mode", 0}}}}));                   // no matrix mode
    CHECK(refused({{"Channel Mixer", {{"Red", {900, 100, 0}}}}}));
    CHECK(serialize({{"SoftLight", {{"Enabled", true}, {"Strength", 40}}}}) == "[SoftLight]\nEnabled=true\nStrength=40\n\n");
    CHECK(refused({{"SoftLight", {{"Strength", 101}}}}));
    CHECK(serialize({{"LensProfile", {{"LcMode", "lfauto"}, {"UseCA", true}}}}) == "[LensProfile]\nLcMode=lfauto\nUseCA=true\n\n");
    CHECK(serialize({{"LensProfile", {{"LcMode", "exif"}}}}) == "[LensProfile]\nLcMode=exif\n\n");
    CHECK(refused({{"LensProfile", {{"LcMode", "lcp"}}}}));               // only automatic and embedded
    CHECK(refused({{"LensProfile", {{"LcMode", "lfmanual"}}}}));
    CHECK(refused({{"LensProfile", {{"LCPFile", "/etc/passwd"}}}}));      // no file paths
    CHECK(refused({{"LensProfile", {{"Enabled", true}}}}));
    CHECK(serialize({{"Sharpening", {{"Enabled", true}, {"Method", "rld"}, {"DeconvRadius", 0.8}, {"DeconvAutoRadius", false}}}}) ==
          "[Sharpening]\nDeconvAutoRadius=false\nDeconvRadius=0.8\nEnabled=true\nMethod=rld\n\n");
    CHECK(refused({{"Sharpening", {{"Method", "usm"}}}}));
    CHECK(refused({{"Sharpening", {{"Method", "psf"}}}}));
    CHECK(refused({{"Sharpening", {{"PSFKernel", "/etc/passwd"}}}}));
    CHECK(refused({{"Sharpening", {{"DeconvRadius", 0.3}}}}));
    CHECK(refused({{"Sharpening", {{"Contrast", 201}}}}));

    CHECK(serialize({{"ToneCurve", {{"CurveMode", "Neutral"}, {"CurveMode2", "Neutral"}}}}) == "[ToneCurve]\nCurveMode=Neutral\nCurveMode2=Neutral\n\n");
    CHECK(refused({{"ToneCurve", {{"CurveMode", "Standard"}}}}));         // the editor assumes Neutral

    // grain and film simulation (the LUT is an id that the resolver turns into a file)
    CHECK(serialize({{"Grain", {{"Enabled", true}, {"ISO", 800}, {"Strength", 35}, {"Color", false}}}}) ==
          "[Grain]\nColor=false\nEnabled=true\nISO=800\nStrength=35\n\n");
    CHECK(refused({{"Grain", {{"ISO", 99}}}}));
    CHECK(refused({{"Grain", {{"Strength", 101}}}}));
    {
        Resolver lut = [](const std::string &id) -> std::string { if (id == "u1") return "/tmp/x/film.cube"; throw PatchError("no such LUT"); };
        CHECK(serialize({{"Film Simulation", {{"Enabled", true}, {"ClutFilename", "u1"}, {"Strength", 80}}}}, lut) ==
              "[Film Simulation]\nClutFilename=/tmp/x/film.cube\nEnabled=true\nStrength=80\n\n");
        CHECK(serialize({{"Film Simulation", {{"ClutFilename", ""}}}}, lut) == "[Film Simulation]\nClutFilename=\n\n");
        bool r = false;
        try { serialize({{"Film Simulation", {{"ClutFilename", "u9"}}}}, lut); } catch (const PatchError &) { r = true; }
        CHECK(r);                                                         // an unknown id
        CHECK(refused({{"Film Simulation", {{"ClutFilename", "/etc/passwd"}}}}));  // without a resolver nothing is a file
        CHECK(refused({{"Film Simulation", {{"ClutFilename", 3}}}}));
        CHECK(serialize({{"Film Simulation", {{"ClutParams", {{"gain", {0.5}}, {"hs", {1.5, 0.25}}}}}}}) ==
              "[Film Simulation]\nClutParams=gain=0.5;hs=1.5,0.25;\n\n");
        CHECK(serialize({{"Film Simulation", {{"ClutParams", json::object()}}}}) == "[Film Simulation]\nClutParams=\n\n");
        CHECK(refused({{"Film Simulation", {{"ClutParams", {{"a b", {1}}}}}}}));        // a name
        CHECK(refused({{"Film Simulation", {{"ClutParams", {{"a=b", {1}}}}}}}));
        CHECK(refused({{"Film Simulation", {{"ClutParams", {{"a", json::array()}}}}}}));
        CHECK(refused({{"Film Simulation", {{"ClutParams", {{"a", {"x"}}}}}}}));
        CHECK(refused({{"Film Simulation", {{"ClutParams", "a=1;"}}}}));
        CHECK(refused({{"Film Simulation", {{"Strength", 101}}}}));
        CHECK(refused({{"Film Simulation", {{"AfterToneCurve", true}}}}));
    }

    CHECK(refused(json::object()));
    CHECK(refused(json::array()));
    CHECK(refused({{"Nope", {{"A", 1}}}}));
    CHECK(refused({{"Version", {{"Version", 1}}}}));          // never writable
    CHECK(refused({{"General", {{"Rank", 5}}}}));
    CHECK(refused({{"Exposure", {{"Nope", 1}}}}));
    CHECK(refused({{"Exposure", {{"Compensation", 13}}}}));    // out of range
    CHECK(refused({{"Exposure", {{"Compensation", "1"}}}}));   // wrong type
    CHECK(refused({{"Exposure", {{"Enabled", 1}}}}));
    CHECK(refused({{"Exposure", json::object()}}));
    CHECK(refused({{"Exposure", {{"HLRecovery", "Off\n[Crop]\nEnabled=true"}}}}));  // no injection
    CHECK(refused({{"Exposure", {{"Compensation", std::numeric_limits<double>::infinity()}}}}));
    CHECK(refused({{"ToneCurve", {{"Curve", {1, 0, 0, 0.5}}}}}));          // even length
    CHECK(refused({{"ToneCurve", {{"Curve", {1, 0, 0, 0, 1, 1, 1}}}}}));   // x not increasing
    CHECK(refused({{"ToneCurve", {{"Curve", {9, 0, 0, 1, 1}}}}}));         // bad type
    CHECK(refused({{"Exposure", 3}}));

    json p = parse("[Version]\nVersion=1047\n\n[Exposure]\nEnabled=true\nCompensation=0.40000000000000002\n"
                   "Black=0\nHLRecovery=Off\n\n[ToneCurve]\nCurve=1;0;0;1;1;\n# comment\n");
    CHECK(p["Version"]["Version"] == 1047);
    CHECK(p["Exposure"]["Enabled"] == true);
    CHECK(p["Exposure"]["Compensation"].is_number_float());
    CHECK(p["Exposure"]["Black"].is_number_integer());
    CHECK(p["Exposure"]["HLRecovery"] == "Off");
    CHECK(p["ToneCurve"]["Curve"] == "1;0;0;1;1;");

    // every key we allow is a real key of ART's profile format
    std::ifstream f(MART_KNOWN_KEYS);
    json known = json::parse(f, nullptr, false);
    CHECK(known.is_object() && known.contains("groups"));
    if (known.is_object() && known.contains("groups"))
        for (auto &[g, keys] : allowedKeys()) {
            CHECK(known["groups"].contains(g));
            if (!known["groups"].contains(g)) continue;
            for (auto &k : keys) {
                bool found = false;
                for (auto &kk : known["groups"][g]) found |= (kk == k);
                CHECK(found);
                if (!found) std::cerr << "  unknown key [" << g << "] " << k << "\n";
            }
        }
    if (failures) return 1;
    std::cout << "test_arp: ok\n";
    return 0;
}
