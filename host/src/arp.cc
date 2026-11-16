// SPDX-License-Identifier: GPL-3.0-or-later
#include "arp.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <set>
#include <sstream>

namespace mart { namespace arp {

namespace {

enum class Kind { Bool, Int, IntSet, Double, Enum, Curve };

struct Spec {
    Kind kind;
    double lo = 0, hi = 0;
    std::set<std::string> values;  // Enum
    std::set<long long> ints;      // IntSet
};

using Group = std::map<std::string, Spec>;

Spec B() { return {Kind::Bool, 0, 0, {}, {}}; }
Spec I(double lo, double hi) { return {Kind::Int, lo, hi, {}, {}}; }
Spec IS(std::set<long long> v) { return {Kind::IntSet, 0, 0, {}, std::move(v)}; }
Spec D(double lo, double hi) { return {Kind::Double, lo, hi, {}, {}}; }
Spec E(std::set<std::string> v) { return {Kind::Enum, 0, 0, std::move(v), {}}; }
Spec C() { return {Kind::Curve, 0, 0, {}, {}}; }

// Keys and ranges: tools/mcp/reference (the GUI ranges, which the engine accepts)
const std::map<std::string, Group> &table()
{
    static const std::map<std::string, Group> t = {
        {"Exposure", {{"Enabled", B()},
                      {"Compensation", D(-12, 12)},
                      {"Black", D(-2, 2)},
                      {"HLRecovery", E({"Off", "Blend", "Color", "Balanced"})},
                      {"HLRecoveryBlur", I(0, 3)}}},
        {"White Balance", {{"Enabled", B()},
                           {"Setting", E({"Camera", "Auto", "CustomTemp"})},
                           {"Temperature", I(1500, 60000)},
                           {"Green", D(0.02, 10)},
                           {"Equal", D(0.8, 1.5)}}},
        {"ToneCurve", {{"Enabled", B()},
                       {"Contrast", I(-100, 100)},
                       {"BaseCurve", E({"Linear", "Rolloff", "SCurve"})},
                       {"HistogramMatching", B()},
                       {"Curve", C()}}},
        {"Saturation", {{"Enabled", B()}, {"Saturation", I(-100, 100)}, {"Vibrance", I(-100, 100)}}},
        // geometry: the crop rectangle is in pixels of the (coarsely rotated) image that `preview` shows
        {"Crop", {{"Enabled", B()},
                  {"X", I(-1, 100000)},
                  {"Y", I(-1, 100000)},
                  {"W", I(-1, 100000)},
                  {"H", I(-1, 100000)},
                  {"FixedRatio", B()},
                  {"Ratio", E({"As Image", "Current", "1:1", "3:2", "4:3", "16:9", "16:10", "4:5", "5:7", "2:1"})},
                  {"Orientation", E({"As Image", "Landscape", "Portrait"})}}},
        {"Rotation", {{"Enabled", B()}, {"Degree", D(-45, 45)}}},
        {"Coarse Transformation", {{"Rotate", IS({0, 90, 180, 270})}, {"HorizontalFlip", B()}, {"VerticalFlip", B()}}},
    };
    return t;
}

std::string num(double v)
{
    char buf[64];
    std::snprintf(buf, sizeof buf, "%.10g", v);  // the process never changes the "C" locale
    return buf;
}

std::string value(const std::string &g, const std::string &k, const Spec &s, const json &v)
{
    const std::string what = "[" + g + "] " + k;
    switch (s.kind) {
    case Kind::Bool:
        if (!v.is_boolean()) throw PatchError(what + ": expected true or false");
        return v.get<bool>() ? "true" : "false";
    case Kind::Int:
    case Kind::Double: {
        if (!v.is_number()) throw PatchError(what + ": expected a number");
        double d = v.get<double>();
        if (!std::isfinite(d) || d < s.lo || d > s.hi) throw PatchError(what + ": out of range");
        if (s.kind == Kind::Int) {
            if (d != std::floor(d)) throw PatchError(what + ": expected an integer");
            return std::to_string(static_cast<long long>(d));
        }
        return num(d);
    }
    case Kind::IntSet: {
        if (!v.is_number_integer() || !s.ints.count(v.get<long long>())) throw PatchError(what + ": not an allowed value");
        return std::to_string(v.get<long long>());
    }
    case Kind::Enum:
        if (!v.is_string() || !s.values.count(v.get<std::string>()))
            throw PatchError(what + ": not an allowed value");
        return v.get<std::string>();
    case Kind::Curve: {
        // [type, x1, y1, x2, y2, ...] with 0 = linear/identity alone
        if (!v.is_array() || v.empty()) throw PatchError(what + ": expected a list");
        for (auto &e : v)
            if (!e.is_number() || !std::isfinite(e.get<double>())) throw PatchError(what + ": expected numbers");
        double type = v[0].get<double>();
        if (type != std::floor(type) || type < 0 || type > 4) throw PatchError(what + ": bad curve type");
        if (v.size() == 1) {
            if (type != 0) throw PatchError(what + ": a curve needs points");
        } else {
            if (v.size() < 5 || v.size() % 2 == 0) throw PatchError(what + ": bad number of values");
            double lastx = -1;
            for (size_t i = 1; i < v.size(); i += 2) {
                double x = v[i].get<double>(), y = v[i + 1].get<double>();
                if (x < 0 || x > 1 || y < 0 || y > 1 || x <= lastx) throw PatchError(what + ": bad point");
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

} // namespace

std::string serialize(const json &patch)
{
    if (!patch.is_object() || patch.empty()) throw PatchError("the patch must be a non-empty object");
    std::ostringstream out;
    for (auto &[gname, gval] : patch.items()) {
        auto g = table().find(gname);
        if (g == table().end()) throw PatchError("unknown group: " + gname);
        if (!gval.is_object() || gval.empty()) throw PatchError("[" + gname + "]: expected an object of keys");
        out << "[" << gname << "]\n";
        for (auto &[kname, kval] : gval.items()) {
            auto k = g->second.find(kname);
            if (k == g->second.end()) throw PatchError("unknown key: [" + gname + "] " + kname);
            out << kname << "=" << value(gname, kname, k->second, kval) << "\n";
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
            if (!v.empty() && end && *end == 0 && v.find(';') == std::string::npos)
                (*cur)[k] = (d == std::floor(d) && v.find('.') == std::string::npos && v.find('e') == std::string::npos)
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

}} // namespace mart::arp
