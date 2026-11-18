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

// The sections of parameters of the MART interface, for saving a profile: each
// is a checkbox of the Save dialog and stands for the keys of ART's profile
// that the interface edits in it. (They do not always follow ART's groups: the
// flat field of the raw file is with the lens correction, the halation is a
// region of the smoothing tool.)
#pragma once
#include <functional>
#include <string>
#include <vector>

namespace mart {
namespace sections {

struct Section {
    std::string id;
    std::string label;
    bool byDefault;  // checked in the Save dialog at first
};

std::vector<Section> list();

/** how the LUT of the film simulation is written in a profile (what
 * `get-params` says -> the value to save) */
using LutWriter = std::function<std::string(const std::string &)>;

/**
 * The text of a profile with the given sections of `paramsText` (the text of
 * `get-params`); empty if there is nothing of them to save. Throws
 * std::invalid_argument for an unknown id.
 */
std::string build(const std::string &paramsText,
                  const std::vector<std::string> &ids,
                  const LutWriter &lut = nullptr);

}  // namespace sections
}  // namespace mart
