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

#include "localcontrast.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <utility>
#include <vector>

namespace mart {
namespace localcontrast {

const char *const REGION_NAME = "MART local contrast";

namespace {

using Lines = std::vector<std::pair<std::string, std::string>>;

const char *const GROUP = "Local Contrast";

struct Group {
    Lines top;                // Enabled, ShowMask, SelectedRegion
    std::vector<Lines> regions;  // the keys of each, without their suffix
};

bool isTop(const std::string &k)
{
    return k == "Enabled" || k == "ShowMask" || k == "SelectedRegion";
}

// the group of the text; the first region has no suffix in its keys, the
// following ones `_1`, `_2`...
Group parse(const std::string &text)
{
    Group g;
    bool in = false;
    size_t i = 0;
    while (i <= text.size()) {
        size_t j = text.find('\n', i);
        if (j == std::string::npos) j = text.size();
        std::string line = text.substr(i, j - i);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        i = j + 1;
        if (line.empty() || line[0] == '#') continue;
        if (line[0] == '[') {
            in = (line == std::string("[") + GROUP + "]");
            continue;
        }
        auto eq = line.find('=');
        if (!in || eq == std::string::npos) continue;
        std::string k = line.substr(0, eq), v = line.substr(eq + 1);
        if (isTop(k)) {
            g.top.emplace_back(k, v);
            continue;
        }
        size_t idx = 0;
        auto u = k.rfind('_');
        if (u != std::string::npos && u + 1 < k.size() &&
            k.find_first_not_of("0123456789", u + 1) == std::string::npos) {
            idx = std::atoi(k.c_str() + u + 1);
            k.resize(u);
        }
        if (g.regions.size() <= idx) g.regions.resize(idx + 1);
        g.regions[idx].emplace_back(k, v);
    }
    return g;
}

const std::string *find(const Lines &l, const std::string &key)
{
    for (auto &p : l)
        if (p.first == key) return &p.second;
    return nullptr;
}

void set(Lines &l, const std::string &key, const std::string &value)
{
    for (auto &p : l)
        if (p.first == key) {
            p.second = value;
            return;
        }
    l.emplace_back(key, value);
}

int ourRegion(const Group &g)
{
    for (size_t k = 0; k < g.regions.size(); ++k) {
        auto n = find(g.regions[k], "MaskName");
        if (n && *n == REGION_NAME) return int(k);
    }
    return -1;
}

std::string num(double v)
{
    char buf[64];
    std::snprintf(buf, sizeof buf, "%.10g", v);
    return buf;
}

std::vector<double> numbers(const std::string &s)
{
    std::vector<double> r;
    size_t i = 0;
    while (i < s.size()) {
        size_t j = s.find(';', i);
        if (j == std::string::npos) j = s.size();
        r.push_back(std::atof(s.substr(i, j - i).c_str()));
        i = j + 1;
    }
    return r;
}

// the curve of the region: a flat curve with its ends at the middle value
// (which does nothing) and a point between them that is raised or lowered
std::string curve(double fine)
{
    return "1;0;0.5;0;0;0.5;" + num(0.5 + fine / 200) +
           ";0.35;0.35;1;0.5;0;0;";
}

// the "fine" of a curve: the height of its point in the middle
double fineOf(const std::string &c)
{
    auto v = numbers(c);
    for (size_t i = 1; i + 3 < v.size(); i += 4)
        if (std::fabs(v[i] - 0.5) < 1e-6) return (v[i + 1] - 0.5) * 200;
    return 0;
}

// a region that does nothing: no residual contrast and a flat curve
bool inert(const Lines &r)
{
    auto c = find(r, "Contrast");
    if (c && std::atof(c->c_str()) != 0) return false;
    auto cv = find(r, "Curve");
    if (!cv) return true;
    auto v = numbers(*cv);
    for (size_t i = 1; i + 3 < v.size(); i += 4)
        if (std::fabs(v[i + 1] - 0.5) > 1e-9) return false;
    return true;
}

bool isOn(const Lines &r)
{
    auto m = find(r, "MaskEnabled");
    return !(m && *m == "false");
}

}  // namespace

json state(const std::string &profileText)
{
    Group g = parse(profileText);
    json r = {{"Enabled", false}, {"Fine", 0.0}, {"Coarse", 0.0}};
    int k = ourRegion(g);
    if (k < 0) return r;
    auto &l = g.regions[k];
    auto en = find(g.top, "Enabled");
    r["Enabled"] = en && *en == "true" && isOn(l);
    auto c = find(l, "Contrast"), cv = find(l, "Curve");
    r["Coarse"] = c ? std::atof(c->c_str()) : 0.0;
    r["Fine"] = cv ? fineOf(*cv) : 0.0;
    return r;
}

bool present(const std::string &profileText)
{
    return ourRegion(parse(profileText)) >= 0;
}

std::string profileText(const std::string &paramsText)
{
    if (!present(paramsText)) return "";
    json s = state(paramsText);
    // the tool is on when the profile is applied; the region says whether the
    // local contrast is
    return std::string("[Local Contrast]\nEnabled=true\nContrast=") +
           num(s["Coarse"].get<double>()) +
           "\nCurve=" + curve(s["Fine"].get<double>()) +
           "\nMaskEnabled=" + (s["Enabled"].get<bool>() ? "true" : "false") +
           "\nMaskName=" + REGION_NAME + "\n";
}

std::string withoutLocalContrast(const std::string &profileText)
{
    std::string out;
    bool skip = false;
    size_t i = 0;
    while (i < profileText.size()) {
        size_t j = profileText.find('\n', i);
        const size_t end = j == std::string::npos ? profileText.size() : j + 1;
        std::string line = profileText.substr(i, end - i);
        while (!line.empty() && (line.back() == '\n' || line.back() == '\r'))
            line.pop_back();
        if (!line.empty() && line[0] == '[')
            skip = (line == std::string("[") + GROUP + "]");
        if (!skip) out += profileText.substr(i, end - i);
        i = end;
    }
    return out;
}

std::string rewrite(const std::string &profileText, const json &change)
{
    if (!change.is_object())
        throw std::invalid_argument("LocalContrast: expected an object");
    for (auto &[k, v] : change.items()) {
        if (k == "Enabled") {
            if (!v.is_boolean())
                throw std::invalid_argument(
                    "LocalContrast Enabled: expected true or false");
        } else if (k == "Fine" || k == "Coarse") {
            if (!v.is_number() || !std::isfinite(v.get<double>()) ||
                v.get<double>() < -100 || v.get<double>() > 100)
                throw std::invalid_argument("LocalContrast " + k +
                                            ": out of range");
        } else {
            throw std::invalid_argument("LocalContrast: unknown key " + k);
        }
    }

    Group g = parse(profileText);
    const bool toolOn = [&] {
        auto e = find(g.top, "Enabled");
        return e && *e == "true";
    }();
    // the regions of the image, apart from ours; a sole one that does nothing
    // (the default region of an untouched tool) is not worth keeping
    Lines ours;
    std::vector<Lines> others;
    const int k = ourRegion(g);
    for (int j = 0; j < int(g.regions.size()); ++j) {
        if (j == k)
            ours = g.regions[j];
        else
            others.push_back(g.regions[j]);
    }
    if (others.size() == 1 && inert(others[0])) others.clear();
    if (k < 0) {  // off until it is told otherwise
        set(ours, "Contrast", "0");
        set(ours, "Curve", curve(0));
        set(ours, "MaskEnabled", "false");
        set(ours, "MaskName", REGION_NAME);
    }
    if (change.contains("Coarse"))
        set(ours, "Contrast", num(change["Coarse"].get<double>()));
    if (change.contains("Fine"))
        set(ours, "Curve", curve(change["Fine"].get<double>()));
    bool enabled = toolOn;
    if (change.contains("Enabled")) {
        if (change["Enabled"].get<bool>()) {
            if (!toolOn)  // the regions the sidecar has were off with the
                          // tool: they stay off
                for (auto &o : others) set(o, "MaskEnabled", "false");
            set(ours, "MaskEnabled", "true");
            enabled = true;
        } else {
            set(ours, "MaskEnabled", "false");
            bool another = false;
            for (auto &o : others) another = another || isOn(o);
            if (!another) enabled = false;
        }
    }

    std::string out = std::string("[") + GROUP + "]\nEnabled=" +
                      (enabled ? "true" : "false") +
                      "\nShowMask=-1\nSelectedRegion=0\n";
    others.push_back(ours);
    for (size_t j = 0; j < others.size(); ++j)
        for (auto &p : others[j])
            out += p.first + (j ? "_" + std::to_string(j) : "") + "=" +
                   p.second + "\n";
    return out + "\n";
}

}  // namespace localcontrast
}  // namespace mart
