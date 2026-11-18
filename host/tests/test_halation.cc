/* -*- C++ -*-
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

// Unit tests of the halation region.
#include "../src/halation.h"
#include <iostream>

using namespace mart::halation;
using json = nlohmann::json;

static int failures = 0;
#define CHECK(c)                                                               \
    do {                                                                       \
        if (!(c)) {                                                            \
            ++failures;                                                        \
            std::cerr << __FILE__ << ":" << __LINE__                           \
                      << ": CHECK failed: " #c "\n";                           \
        }                                                                      \
    } while (0)

static bool refused(const std::string &text, const json &change)
{
    try {
        rewrite(text, change);
    } catch (const std::invalid_argument &) {
        return true;
    }
    return false;
}

static bool has(const std::string &text, const std::string &line)
{
    return text.find("\n" + line + "\n") != std::string::npos;
}

int main()
{
    // a sidecar with one smoothing region (non-local means denoise), the tool
    // on
    const std::string on =
        "[Exposure]\nEnabled=true\n\n[Smoothing]\nEnabled=true\nMode_1="
        "3\nChannel_1=1\nNLStrength_1=51\n"
        "MaskName_1=\nMaskEnabled_1=true\nHalationSize_1=1\nHalationColor_1="
        "0\nSelectedRegion=0\nShowMask=-1\n\n[Grain]\nEnabled=false\n";
    // the same, with the tool off
    std::string off = on;
    off.replace(off.find("Enabled=true\nMode_1"), 12, "Enabled=false");

    CHECK(state(on) ==
          json({{"Enabled", false}, {"Strength", 1.0}, {"Tint", 0.0}}));

    // turning it on adds a region after the one the sidecar has, and leaves
    // that one as it is
    std::string t =
        rewrite(on, {{"Enabled", true}, {"Strength", 2.5}, {"Tint", -0.1}});
    CHECK(t.compare(0, 12, "[Smoothing]\n") == 0);
    CHECK(has("\n" + t, "Mode_1=3") && has("\n" + t, "NLStrength_1=51") &&
          has("\n" + t, "MaskEnabled_1=true"));
    CHECK(has("\n" + t, "Mode_2=7") &&
          has("\n" + t, "MaskName_2=MART halation") &&
          has("\n" + t, "HalationSize_2=2.5") &&
          has("\n" + t, "HalationColor_2=-0.1") &&
          has("\n" + t, "MaskEnabled_2=true") && has("\n" + t, "Enabled=true"));
    CHECK(t.find("[Exposure]") == std::string::npos &&
          t.find("[Grain]") == std::string::npos);  // only the Smoothing group
    json s = state(t);
    CHECK(s["Enabled"] == true && s["Strength"] == 2.5 && s["Tint"] == -0.1);

    // editing it changes it in place: no third region
    std::string t2 = rewrite(t, {{"Enabled", true}, {"Strength", 0.8}});
    CHECK(t2.find("_3=") == std::string::npos);
    CHECK(has("\n" + t2, "HalationSize_2=0.8") &&
          has("\n" + t2, "HalationColor_2=-0.1"));

    // turning it off: the region stays (off), the other one still works, so the
    // tool stays on
    std::string t3 = rewrite(t2, {{"Enabled", false}});
    CHECK(has("\n" + t3, "MaskEnabled_2=false") &&
          has("\n" + t3, "Enabled=true"));
    CHECK(state(t3)["Enabled"] == false);

    // with the tool off in the sidecar, the sidecar's region must not start
    // working: it is switched off, and with halation off again the tool goes
    // off
    std::string u = rewrite(off, {{"Enabled", true}});
    CHECK(has("\n" + u, "Enabled=true") &&
          has("\n" + u, "MaskEnabled_1=false") &&
          has("\n" + u, "MaskEnabled_2=true"));
    std::string u2 = rewrite(u, {{"Enabled", false}});
    CHECK(has("\n" + u2, "Enabled=false") &&
          has("\n" + u2, "MaskEnabled_2=false"));

    // a profile without any smoothing region
    std::string none = "[Smoothing]\nEnabled=false\n";
    std::string n1 = rewrite(none, {{"Enabled", true}});
    CHECK(has("\n" + n1, "Mode_1=7") && has("\n" + n1, "MaskEnabled_1=true") &&
          has("\n" + n1, "Enabled=true"));
    CHECK(state("")["Enabled"] == false);
    CHECK(has("\n" + rewrite("", {{"Strength", 1.5}}),
              "MaskEnabled_1=false"));  // a region is made, still off

    // a region that has the mode but not the name (made in ART) is not ours
    CHECK(state("[Smoothing]\nEnabled=true\nMode_1=7\nMaskName_1="
                "\nHalationSize_1=3\nMaskEnabled_1=true\n")["Strength"] == 1.0);

    CHECK(refused(on, {{"Strength", 6}}));
    CHECK(refused(on, {{"Strength", 0}}));
    CHECK(refused(on, {{"Tint", 0.6}}));
    CHECK(refused(on, {{"Enabled", 1}}));
    CHECK(refused(on, {{"Mode", 7}}));
    CHECK(refused(on, json::array()));

    if (failures == 0) std::cout << "halation: ok\n";
    return failures ? 1 : 0;
}
