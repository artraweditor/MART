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

// Halation: a region of ART's Smoothing tool in halation mode, without a mask,
// put after the regions that the sidecar already has. It is found again by its
// name, so that editing it changes it in place.
#pragma once
#include "third_party/json.hpp"
#include <string>

namespace mart {
namespace halation {

using json = nlohmann::json;

/** the name of the region (its `MaskName`), by which it is found again */
extern const char *const REGION_NAME;

/** {"Enabled", "Strength", "Tint"} of the halation region of a profile (the
 * text of `get-params`); the defaults if none */
json state(const std::string &profileText);

/** does this profile (or `get-params`) text have the halation region? */
bool present(const std::string &profileText);

/** the `[Smoothing]` group of a profile that holds only the halation region of
 * `paramsText` (the text of `get-params`), numbered 1, switched on or off as it
 * is; empty if there is none */
std::string profileText(const std::string &paramsText);

/** the profile text without its `[Smoothing]` group */
std::string withoutSmoothing(const std::string &profileText);

/**
 * The text of a `[Smoothing]` group to apply (replacing the regions of the
 * tool) that holds every region of `profileText` as it is, and the halation
 * region changed by `change`: an object with any of `Enabled` (bool),
 * `Strength` (0.001..5) and `Tint` (-0.5..0.5). The region is added, after the
 * others, if there is none. Turning it on also turns the tool on, but regions
 * that were switched off with the tool stay off; turning it off turns the tool
 * off when no other region is on. Throws std::invalid_argument for a bad
 * `change`.
 */
std::string rewrite(const std::string &profileText, const json &change);

}  // namespace halation
}  // namespace mart
