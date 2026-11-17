// Unit tests of the sections of a saved profile and the halation in profiles. SPDX-License-Identifier: GPL-3.0-or-later
#include "../src/halation.h"
#include "../src/sections.h"
#include <iostream>

using namespace mart;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { ++failures; std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #c "\n"; } } while (0)

static bool has(const std::string &text, const std::string &line) { return text.find("\n" + line + "\n") != std::string::npos || text.compare(0, line.size() + 1, line + "\n") == 0; }
static bool refused(const std::string &p, const std::vector<std::string> &ids)
{
    try { sections::build(p, ids); } catch (const std::invalid_argument &) { return true; }
    return false;
}

int main()
{
    // what `get-params` says (a part of it), with a smoothing region of the sidecar and the halation of MART
    const std::string params =
        "[Exposure]\nEnabled=true\nCompensation=0.7\nBlack=0\nHLRecovery=Color\nHLRecoveryBlur=0\n\n"
        "[ToneCurve]\nEnabled=true\nContrast=10\nCurve=1;0;0;1;1;\nCurve2=0;\n\n"
        "[White Balance]\nEnabled=true\nSetting=Camera\nTemperature=5170\n\n"
        "[RAW]\nCA=true\nDarkFrame=\nFlatFieldEnabled=true\nFlatFieldUseEmbedded=true\nFlatFieldBlurRadius=32\nHotPixelFilter=false\n\n"
        "[LensProfile]\nLcMode=lfauto\nUseCA=false\n\n"
        "[Crop]\nEnabled=true\nX=10\nY=20\nW=300\nH=200\n\n"
        "[Smoothing]\nEnabled=true\nMode_1=3\nNLStrength_1=51\nMaskName_1=\nMaskEnabled_1=true\n"
        "Mode_2=7\nMaskName_2=MART halation\nMaskEnabled_2=true\nHalationSize_2=2.5\nHalationColor_2=-0.1\n\n"
        "[Grain]\nEnabled=false\nISO=400\nStrength=50\nColor=false\n";

    // the sections, and what is checked at first
    auto l = sections::list();
    CHECK(l.size() >= 12);
    bool wbOff = false, exposureOn = false;
    for (auto &s : l) { if (s.id == "wb") wbOff = !s.byDefault; if (s.id == "exposure") exposureOn = s.byDefault; }
    CHECK(wbOff && exposureOn);  // white balance and the geometry are of the image: not at first

    // a whole group
    std::string t = sections::build(params, {"exposure"});
    CHECK(t == "[Exposure]\nEnabled=true\nCompensation=0.7\nBlack=0\nHLRecovery=Color\nHLRecoveryBlur=0\n\n");
    // the groups of a section, in the order of the sections, whatever the order asked
    t = sections::build(params, {"tone", "exposure"});
    CHECK(t.compare(0, 10, "[Exposure]") == 0 && t.find("[ToneCurve]") != std::string::npos);
    CHECK(has("\n" + t, "Curve2=0;"));  // a group is saved as a whole, also what the interface has no control for
    // the flat field: a few keys of RAW, with the lens correction
    t = sections::build(params, {"lens"});
    CHECK(has("\n" + t, "[LensProfile]") && has("\n" + t, "LcMode=lfauto"));
    CHECK(has("\n" + t, "[RAW]") && has("\n" + t, "FlatFieldEnabled=true") && has("\n" + t, "FlatFieldUseEmbedded=true"));
    CHECK(t.find("\nCA=") == std::string::npos && t.find("DarkFrame") == std::string::npos && t.find("FlatFieldBlurRadius") == std::string::npos);
    // the halation: only its region, numbered 1 (the region of the sidecar is not in it)
    t = sections::build(params, {"halation"});
    CHECK(t == "[Smoothing]\nEnabled=true\nMode_1=7\nChannel_1=2\nMaskName_1=MART halation\nMaskEnabled_1=true\nHalationSize_1=2.5\nHalationColor_1=-0.1\n\n");
    CHECK(t.find("NLStrength") == std::string::npos);
    CHECK(halation::present(t));
    nlohmann::json st = halation::state(t);
    CHECK(st["Enabled"] == true && st["Strength"] == 2.5 && st["Tint"] == -0.1);
    // nothing of a section that the image does not have
    CHECK(sections::build("[Exposure]\nEnabled=true\n", {"halation"}).empty());
    CHECK(sections::build("[Exposure]\nEnabled=true\n", {"grain"}).empty());
    CHECK(sections::build(params, {}).empty());
    // everything
    std::vector<std::string> all;
    for (auto &s : l) all.push_back(s.id);
    t = sections::build(params, all);
    CHECK(t.find("[Crop]") != std::string::npos && t.find("[White Balance]") != std::string::npos);
    CHECK(refused(params, {"nope"}));
    CHECK(refused(params, {"exposure", "Exposure"}));

    // applying such a profile: the Smoothing group is taken out, the rest goes as it is
    std::string profile = sections::build(params, {"exposure", "halation", "grain"});
    std::string rest = halation::withoutSmoothing(profile);
    CHECK(rest.find("[Smoothing]") == std::string::npos && rest.find("Mode_1") == std::string::npos);
    CHECK(rest.find("[Exposure]") != std::string::npos && rest.find("[Grain]") != std::string::npos);
    CHECK(halation::withoutSmoothing("[Exposure]\nEnabled=true\n") == "[Exposure]\nEnabled=true\n");
    CHECK(!halation::present(rest));
    // a smoothing group of ART's, not of MART: not halation
    CHECK(!halation::present("[Smoothing]\nEnabled=true\nMode_1=7\nMaskName_1=\n"));

    if (failures == 0) std::cout << "sections: ok\n";
    return failures ? 1 : 0;
}
