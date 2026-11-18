// The sections of parameters of the MART interface, for saving a profile: each is a checkbox of the Save dialog and
// stands for the keys of ART's profile that the interface edits in it. (They do not always follow ART's groups: the
// flat field of the raw file is with the lens correction, the halation is a region of the smoothing tool.)
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <functional>
#include <string>
#include <vector>

namespace mart { namespace sections {

struct Section {
    std::string id;
    std::string label;
    bool byDefault;   // checked in the Save dialog at first
};

std::vector<Section> list();

/** how the LUT of the film simulation is written in a profile (what `get-params` says -> the value to save) */
using LutWriter = std::function<std::string(const std::string &)>;

/**
 * The text of a profile with the given sections of `paramsText` (the text of `get-params`); empty if there is nothing
 * of them to save. Throws std::invalid_argument for an unknown id.
 */
std::string build(const std::string &paramsText, const std::vector<std::string> &ids, const LutWriter &lut = nullptr);

}} // namespace mart::sections
