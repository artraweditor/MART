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

// Local contrast of the Detail tab: a region of ART's Local Contrast tool,
// without a mask, put after the regions that the sidecar already has. It is
// found again by its name, so that editing it changes it in place. "Coarse" is
// the residual contrast of the region; "Fine" is the middle point of its curve.
#pragma once
#include "third_party/json.hpp"
#include <string>

namespace mart {
namespace localcontrast {

using json = nlohmann::json;

/** the name of the region (its `MaskName`), by which it is found again */
extern const char *const REGION_NAME;

/** {"Enabled", "Fine", "Coarse"} of the region of a profile (the text of
 * `get-params`); the defaults if none */
json state(const std::string &profileText);

/** does this profile (or `get-params`) text have the region? */
bool present(const std::string &profileText);

/** the `[Local Contrast]` group of a profile that holds only the region of
 * `paramsText` (the text of `get-params`); empty if there is none */
std::string profileText(const std::string &paramsText);

/** the profile text without its `[Local Contrast]` group */
std::string withoutLocalContrast(const std::string &profileText);

/**
 * The text of a `[Local Contrast]` group to apply (replacing the regions of the
 * tool) that holds every region of `profileText` as it is, and our region
 * changed by `change`: an object with any of `Enabled` (bool), `Fine` and
 * `Coarse` (-100..100). The region is added, after the others, if there is
 * none (a sole region that does nothing, like the one of an untouched tool, is
 * dropped). Turning it on also turns the tool on, but regions that were
 * switched off with the tool stay off; turning it off turns the tool off when
 * no other region is on. Throws std::invalid_argument for a bad `change`.
 */
std::string rewrite(const std::string &profileText, const json &change);

}  // namespace localcontrast
}  // namespace mart
