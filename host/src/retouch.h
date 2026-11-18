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

// Retouching: regions of ART's "Color/tone correction" tool (the
// `[ColorCorrection]` group) that MART makes and edits with a simplified
// interface: each is in perceptual mode with a hue shift, an output saturation,
// gain, lift, gamma, pivot and compression, and may be limited by a brush mask.
// They are put after the regions that the sidecar already has and are found
// again by their name ("MART retouch <id>").
#pragma once
#include "third_party/json.hpp"
#include <string>

namespace mart {
namespace retouch {

using json = nlohmann::json;

/** the prefix of the `MaskName` of our regions; the rest of the name is the
 * region's id */
extern const char *const NAME_PREFIX;

/**
 * Our regions in a profile (the text of `get-params`): an object by id (a
 * decimal string), in the order of the file: `Enabled`, `HueShift` (degrees),
 * `OutSaturation`, `Slope` (gain), `Offset` (lift), `Power` (gamma), `Pivot`,
 * `Compression`, `BrushEnabled`, `BrushFeather`, `BrushOpacity`,
 * `BrushSmoothness` (0..100) and `Strokes`: a list of groups `[radius, paint
 * (1) or erase (0), hardness, x1, y1, x2, y2, ...]` (positions are fractions of
 * the width and height of the image, from its top left corner). `Enabled` is
 * false for all of them when the tool is off.
 */
json state(const std::string &profileText);

/** does this profile (or `get-params`) text have our regions? */
bool present(const std::string &profileText);

/**
 * The text of a `[ColorCorrection]` group to apply (it replaces the regions of
 * the tool) that holds every region of `profileText` as it is, and our regions
 * changed by `change`: an object by id; a value that is null removes the
 * region, an object sets those of the keys of `state` that it has (the region
 * is added, after the others, if there is none with that id). Setting `Enabled`
 * to true turns the tool on, but regions that were switched off with the tool
 * stay off; turning off the last region that is on turns the tool off. Throws
 * std::invalid_argument for a bad change.
 */
std::string rewrite(const std::string &profileText, const json &change);

/** the `[ColorCorrection]` group of a profile that holds only our regions of
 * `paramsText`, numbered from 1, as they show (a region is off if the tool is);
 * empty if there are none */
std::string profileText(const std::string &paramsText);

/** the text of a profile without its `[ColorCorrection]` group */
std::string withoutColorCorrection(const std::string &profileText);

/**
 * The `[ColorCorrection]` group to apply for a profile that has regions of
 * ours: those of `paramsText` that are not ours, and ours as `profileText` has
 * them (it takes the place of the ones that the image had).
 */
std::string replace(const std::string &paramsText,
                    const std::string &profileText);

// the strokes of a brush mask as ART stores them (a base64 list of half floats)
// and as `state` shows them; exposed for the tests
std::string packStrokes(const json &groups);
json unpackStrokes(const std::string &packed);

}  // namespace retouch
}  // namespace mart
