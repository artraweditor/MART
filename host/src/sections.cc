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

#include "sections.h"
#include "halation.h"
#include "localcontrast.h"
#include "retouch.h"
#include <set>
#include <stdexcept>
#include <utility>

namespace mart {
namespace sections {

namespace {

struct Item {
    std::string group;
    std::set<std::string> keys;  // empty: the whole group
};

struct Def {
    Section section;
    std::vector<Item> items;  // none: the halation, which is not a group
};

const std::vector<Def> &table()
{
    static const std::vector<Def> t = {
        {{"exposure", "Exposure and highlight recovery", true},
         {{"Exposure", {}}}},
        {{"haze", "Haze removal", true}, {{"Dehaze", {}}}},
        {{"tone", "Contrast and tone curve", true}, {{"ToneCurve", {}}}},
        {{"toneeq", "Tone equalizer", true}, {{"ToneEqualizer", {}}}},
        {{"wb", "White balance", false}, {{"White Balance", {}}}},
        {{"saturation", "Saturation and vibrance", true}, {{"Saturation", {}}}},
        {{"mixer", "Primaries correction", true}, {{"Channel Mixer", {}}}},
        {{"softlight", "Soft light", true}, {{"SoftLight", {}}}},
        {{"film", "Film simulation", true}, {{"Film Simulation", {}}}},
        // the flat field of the raw file is a few keys of the RAW group, which
        // also has the dark frame, the hot pixels...
        {{"lens", "Lens correction and flat field", true},
         {{"LensProfile", {}},
          {"RAW", {"FlatFieldEnabled", "FlatFieldUseEmbedded"}}}},
        {{"sharpening", "Capture sharpening", true}, {{"Sharpening", {}}}},
        {{"denoise", "Noise reduction", true}, {{"Denoise", {}}}},
        {{"grain", "Film grain", true}, {{"Grain", {}}}},
        {{"halation", "Halation", true}, {}},
        {{"localcontrast", "Local contrast", true}, {}},
        {{"retouch", "Retouching", true}, {}},
        {{"geometry", "Crop and rotation", false},
         {{"Crop", {}}, {"Rotation", {}}, {"Coarse Transformation", {}}, {"PCVignette", {}}}},
    };
    return t;
}

using Lines = std::vector<std::pair<std::string, std::string>>;

// the key=value lines of a group of the text, in order; false if there is no
// such group
bool group(const std::string &text, const std::string &name, Lines &out)
{
    bool in = false, found = false;
    size_t i = 0;
    while (i <= text.size()) {
        size_t j = text.find('\n', i);
        if (j == std::string::npos) j = text.size();
        std::string line = text.substr(i, j - i);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        i = j + 1;
        if (line.empty() || line[0] == '#') continue;
        if (line[0] == '[') {
            in = (line == "[" + name + "]");
            found = found || in;
            continue;
        }
        auto eq = line.find('=');
        if (in && eq != std::string::npos)
            out.emplace_back(line.substr(0, eq), line.substr(eq + 1));
    }
    return found;
}

}  // namespace

std::vector<Section> list()
{
    std::vector<Section> r;
    for (auto &d : table()) r.push_back(d.section);
    return r;
}

std::string build(const std::string &paramsText,
                  const std::vector<std::string> &ids, const LutWriter &lut)
{
    std::set<std::string> wanted(ids.begin(), ids.end());
    for (auto &id : wanted) {
        bool known = false;
        for (auto &d : table()) known = known || d.section.id == id;
        if (!known) throw std::invalid_argument("unknown section: " + id);
    }
    std::string out;
    for (auto &d : table()) {
        if (!wanted.count(d.section.id)) continue;
        if (d.items.empty()) {  // the halation, or the retouching regions: not
                                // groups of the profile
            const std::string h =
                d.section.id == "retouch"
                    ? retouch::profileText(paramsText)
                : d.section.id == "localcontrast"
                    ? localcontrast::profileText(paramsText)
                    : halation::profileText(paramsText);
            if (!h.empty()) out += h + "\n";
            continue;
        }
        for (auto &item : d.items) {
            Lines l;
            if (!group(paramsText, item.group, l)) continue;
            std::string body;
            for (auto &[k, v] : l) {
                if (!item.keys.empty() && !item.keys.count(k)) continue;
                // the LUT of the film simulation is written so that ART can
                // find it too (see Luts::toUri)
                const bool isLut = item.group == "Film Simulation" &&
                                   k == "ClutFilename" && lut;
                body += k + "=" + (isLut ? lut(v) : v) + "\n";
            }
            if (!body.empty()) out += "[" + item.group + "]\n" + body + "\n";
        }
    }
    return out;
}

}  // namespace sections
}  // namespace mart
