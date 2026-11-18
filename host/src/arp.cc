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

#include "arp.h"
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <set>
#include <sstream>

namespace mart {
namespace arp {

namespace {

enum class Kind {
    Bool,
    Int,
    IntSet,
    Double,
    Enum,
    Curve,
    IntList,
    FileId,
    ClutParams,
    FlatCurve
};

struct Spec {
    Kind kind;
    double lo = 0, hi = 0;
    std::set<std::string> values;  // Enum
    std::set<long long> ints;      // IntSet
    size_t n = 0;                  // IntList: the number of values
};

using Group = std::map<std::string, Spec>;

Spec B() { return {Kind::Bool, 0, 0, {}, {}}; }
Spec I(double lo, double hi) { return {Kind::Int, lo, hi, {}, {}}; }
Spec IS(std::set<long long> v)
{
    return {Kind::IntSet, 0, 0, {}, std::move(v)};
}
Spec D(double lo, double hi) { return {Kind::Double, lo, hi, {}, {}}; }
Spec E(std::set<std::string> v) { return {Kind::Enum, 0, 0, std::move(v), {}}; }
Spec C() { return {Kind::Curve, 0, 0, {}, {}}; }
// a flat curve that is a straight line at this level (0..1):
// `1;0;a;0;0;1;a;0;0;`
Spec LV() { return {Kind::FlatCurve, 0, 1, {}, {}}; }
Spec F()
{
    return {Kind::FileId, 0, 0, {}, {}};
}  // the id of a file the host offers ("" for none)
Spec P()
{
    return {Kind::ClutParams, 0, 0, {}, {}};
}  // {"name": [numbers]}: the parameters of a LUT script
// a list of `n` integers, each within lo..hi
Spec L(size_t n, double lo, double hi)
{
    Spec s{Kind::IntList, lo, hi, {}, {}};
    s.n = n;
    return s;
}

// Keys and ranges: tools/mcp/reference (the GUI ranges, which the engine
// accepts)
const std::map<std::string, Group> &table()
{
    static const std::map<std::string, Group> t = {
        {"Exposure",
         {{"Enabled", B()},
          {"Compensation", D(-12, 12)},
          {"Black", D(-2, 2)},
          {"HLRecovery", E({"Off", "Blend", "Color", "Balanced"})},
          {"HLRecoveryBlur", I(0, 3)}}},
        {"White Balance",
         {{"Enabled", B()},
          {"Setting", E({"Camera", "Auto", "CustomTemp"})},
          {"Temperature", I(1500, 60000)},
          {"Green", D(0.02, 10)},
          {"Equal", D(0.8, 1.5)}}},
        {"ToneCurve",
         {{"Enabled", B()},
          {"Contrast", I(-100, 100)},
          {"BaseCurve", E({"Linear", "Rolloff", "SCurve"})},
          {"CurveMode", E({"Neutral"})},
          {"CurveMode2", E({"Neutral"})},
          {"HistogramMatching", B()},
          {"Curve", C()}}},
        {"Saturation",
         {{"Enabled", B()},
          {"Saturation", I(-100, 100)},
          {"Vibrance", I(-100, 100)}}},
        {"ToneEqualizer",
         {{"Enabled", B()},
          {"Band0", I(-100, 100)},
          {"Band1", I(-100, 100)},
          {"Band2", I(-100, 100)},
          {"Band3", I(-100, 100)},
          {"Band4", I(-100, 100)},
          {"Regularization", I(0, 4)},
          {"Pivot", D(-12, 12)}}},
        // primaries mode only (Mode 1): a hue and a saturation shift for each
        // of red, green and blue
        {"Channel Mixer",
         {{"Enabled", B()},
          {"Mode", IS({1})},
          {"HueTweak", L(3, -100, 100)},
          {"SatTweak", L(3, -100, 100)}}},
        // noise reduction: the presets of the Detail tab (the keys are those of
        // the profiles it uses)
        {"Denoise",
         {{"Enabled", B()},
          {"ColorSpace", E({"RGB", "LAB"})},
          {"Aggressive", B()},
          {"Gamma", D(1, 3)},
          {"Luminance", D(0, 100)},
          {"LuminanceDetail", D(0, 100)},
          {"LuminanceDetailThreshold", I(0, 100)},
          {"ChrominanceMethod", I(0, 1)},
          {"ChrominanceAutoFactor", D(0, 1)},
          {"SmoothingEnabled", B()},
          {"GuidedChromaRadius", I(0, 20)},
          {"NLStrength", I(0, 100)}}},
        {"Grain",
         {{"Enabled", B()},
          {"ISO", I(100, 6400)},
          {"Strength", I(0, 100)},
          {"Color", B()}}},
        {"Film Simulation",
         {{"Enabled", B()},
          {"Strength", I(0, 100)},
          {"ClutFilename", F()},
          {"ClutParams", P()}}},
        // only the uniform level of the strength curve is written, and always
        // in RGB mode
        {"Dehaze", {{"Enabled", B()}, {"Strength", LV()}, {"Luminance", B()}}},
        // no Enabled key: each feature has its own switch. The flat field of
        // the raw file itself (DNG gain maps)
        {"RAW", {{"FlatFieldEnabled", B()}, {"FlatFieldUseEmbedded", B()}}},
        {"SoftLight", {{"Enabled", B()}, {"Strength", I(0, 100)}}},
        // no Enabled key: the tool is on when LcMode is not "none"; only the
        // automatic and embedded sources are offered
        {"LensProfile",
         {{"LcMode", E({"none", "lfauto", "exif"})},
          {"UseDistortion", B()},
          {"UseVignette", B()},
          {"UseCA", B()}}},
        // capture sharpening: Richardson-Lucy deconvolution with a fixed radius
        {"Sharpening",
         {{"Enabled", B()},
          {"Method", E({"rld"})},
          {"Contrast", D(0, 200)},
          {"DeconvRadius", D(0.4, 2.5)},
          {"DeconvAmount", I(0, 100)},
          {"DeconvAutoRadius", B()}}},
        // geometry: the crop rectangle is in pixels of the (coarsely rotated)
        // image that `preview` shows
        {"Crop",
         {{"Enabled", B()},
          {"X", I(-1, 100000)},
          {"Y", I(-1, 100000)},
          {"W", I(-1, 100000)},
          {"H", I(-1, 100000)},
          {"FixedRatio", B()},
          {"Ratio", E({"As Image", "Current", "1:1", "3:2", "4:3", "16:9",
                       "16:10", "4:5", "5:7", "2:1"})},
          {"Orientation", E({"As Image", "Landscape", "Portrait"})}}},
        {"Rotation", {{"Enabled", B()}, {"Degree", D(-45, 45)}}},
        {"Coarse Transformation",
         {{"Rotate", IS({0, 90, 180, 270})},
          {"HorizontalFlip", B()},
          {"VerticalFlip", B()}}},
    };
    return t;
}

std::string num(double v)
{
    char buf[64];
    std::snprintf(buf, sizeof buf, "%.10g",
                  v);  // the process never changes the "C" locale
    return buf;
}

std::string value(const std::string &g, const std::string &k, const Spec &s,
                  const json &v, const Resolver &lutPath)
{
    const std::string what = "[" + g + "] " + k;
    switch (s.kind) {
    case Kind::Bool:
        if (!v.is_boolean())
            throw PatchError(what + ": expected true or false");
        return v.get<bool>() ? "true" : "false";
    case Kind::Int:
    case Kind::Double: {
        if (!v.is_number()) throw PatchError(what + ": expected a number");
        double d = v.get<double>();
        if (!std::isfinite(d) || d < s.lo || d > s.hi)
            throw PatchError(what + ": out of range");
        if (s.kind == Kind::Int) {
            if (d != std::floor(d))
                throw PatchError(what + ": expected an integer");
            return std::to_string(static_cast<long long>(d));
        }
        return num(d);
    }
    case Kind::IntSet: {
        if (!v.is_number_integer() || !s.ints.count(v.get<long long>()))
            throw PatchError(what + ": not an allowed value");
        return std::to_string(v.get<long long>());
    }
    case Kind::Enum:
        if (!v.is_string() || !s.values.count(v.get<std::string>()))
            throw PatchError(what + ": not an allowed value");
        return v.get<std::string>();
    case Kind::FileId: {
        if (!v.is_string())
            throw PatchError(what + ": expected the id of a file");
        const std::string id = v.get<std::string>();
        if (id.empty()) return "";
        std::string path = lutPath
                               ? lutPath(id)
                               : "";  // the resolver throws for an unknown id
        if (path.empty() || path.find_first_of("\r\n") != std::string::npos)
            throw PatchError(what + ": no such file");
        return path;
    }
    case Kind::ClutParams: {
        if (!v.is_object())
            throw PatchError(what + ": expected an object of parameters");
        std::string out;
        for (auto &[name, vals] : v.items()) {
            if (name.empty() || name.size() > 64)
                throw PatchError(what + ": bad parameter name");
            for (char c : name)
                if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '_'))
                    throw PatchError(what + ": bad parameter name");
            if (!vals.is_array() || vals.empty() || vals.size() > 4096)
                throw PatchError(what + ": " + name +
                                 ": expected a list of numbers");
            out += name + "=";
            for (size_t i = 0; i < vals.size(); ++i) {
                if (!vals[i].is_number() ||
                    !std::isfinite(vals[i].get<double>()))
                    throw PatchError(what + ": " + name + ": expected numbers");
                out += (i ? "," : "") + num(vals[i].get<double>());
            }
            out += ";";
        }
        return out;
    }
    case Kind::FlatCurve: {
        if (!v.is_number() || !std::isfinite(v.get<double>()) ||
            v.get<double>() < s.lo || v.get<double>() > s.hi)
            throw PatchError(what + ": expected a number from 0 to 1");
        const std::string a = num(v.get<double>());
        return "1;0;" + a + ";0;0;1;" + a + ";0;0;";
    }
    case Kind::IntList: {
        if (!v.is_array() || v.size() != s.n)
            throw PatchError(what + ": expected a list of " +
                             std::to_string(s.n) + " numbers");
        std::string out;
        for (auto &e : v) {
            if (!e.is_number()) throw PatchError(what + ": expected numbers");
            double d = e.get<double>();
            if (!std::isfinite(d) || d < s.lo || d > s.hi)
                throw PatchError(what + ": out of range");
            if (d != std::floor(d))
                throw PatchError(what + ": expected integers");
            out += std::to_string(static_cast<long long>(d)) + ";";
        }
        return out;
    }
    case Kind::Curve: {
        // [type, x1, y1, x2, y2, ...] with 0 = linear/identity alone
        if (!v.is_array() || v.empty())
            throw PatchError(what + ": expected a list");
        for (auto &e : v)
            if (!e.is_number() || !std::isfinite(e.get<double>()))
                throw PatchError(what + ": expected numbers");
        double type = v[0].get<double>();
        if (type != std::floor(type) || type < 0 || type > 4)
            throw PatchError(what + ": bad curve type");
        if (v.size() == 1) {
            if (type != 0) throw PatchError(what + ": a curve needs points");
        } else {
            if (v.size() < 5 || v.size() % 2 == 0)
                throw PatchError(what + ": bad number of values");
            double lastx = -1;
            for (size_t i = 1; i < v.size(); i += 2) {
                double x = v[i].get<double>(), y = v[i + 1].get<double>();
                if (x < 0 || x > 1 || y < 0 || y > 1 || x <= lastx)
                    throw PatchError(what + ": bad point");
                lastx = x;
            }
        }
        std::string out;
        for (auto &e : v) out += num(e.get<double>()) + ";";
        return out;
    }
    }
    return "";
}

}  // namespace

std::string serialize(const json &patch, const Resolver &lutPath)
{
    if (!patch.is_object() || patch.empty())
        throw PatchError("the patch must be a non-empty object");
    std::ostringstream out;
    for (auto &[gname, gval] : patch.items()) {
        auto g = table().find(gname);
        if (g == table().end()) throw PatchError("unknown group: " + gname);
        if (!gval.is_object() || gval.empty())
            throw PatchError("[" + gname + "]: expected an object of keys");
        out << "[" << gname << "]\n";
        for (auto &[kname, kval] : gval.items()) {
            auto k = g->second.find(kname);
            if (k == g->second.end())
                throw PatchError("unknown key: [" + gname + "] " + kname);
            out << kname << "=" << value(gname, kname, k->second, kval, lutPath)
                << "\n";
        }
        out << "\n";
    }
    return out.str();
}

json parse(const std::string &ini)
{
    json doc = json::object();
    json *cur = nullptr;
    std::istringstream in(ini);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty() || line[0] == '#') continue;
        if (line[0] == '[' && line.back() == ']') {
            cur = &doc[line.substr(1, line.size() - 2)];
            *cur = json::object();
            continue;
        }
        auto eq = line.find('=');
        if (!cur || eq == std::string::npos) continue;
        std::string k = line.substr(0, eq), v = line.substr(eq + 1);
        if (v == "true" || v == "false") {
            (*cur)[k] = (v == "true");
        } else {
            char *end = nullptr;
            double d = std::strtod(v.c_str(), &end);
            if (!v.empty() && end && *end == 0 &&
                v.find(';') == std::string::npos)
                (*cur)[k] =
                    (d == std::floor(d) && v.find('.') == std::string::npos &&
                     v.find('e') == std::string::npos)
                        ? json(static_cast<long long>(d))
                        : json(d);
            else
                (*cur)[k] = v;
        }
    }
    return doc;
}

std::vector<std::pair<std::string, std::vector<std::string>>> allowedKeys()
{
    std::vector<std::pair<std::string, std::vector<std::string>>> r;
    for (auto &[g, keys] : table()) {
        std::vector<std::string> ks;
        for (auto &[k, s] : keys) ks.push_back(k);
        r.emplace_back(g, ks);
    }
    return r;
}

}  // namespace arp
}  // namespace mart
