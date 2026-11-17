// SPDX-License-Identifier: GPL-3.0-or-later
#include "halation.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <utility>
#include <vector>

namespace mart { namespace halation {

const char *const REGION_NAME = "MART halation";

namespace {

using Lines = std::vector<std::pair<std::string, std::string>>;

// the key=value lines of the [Smoothing] group, in order
Lines smoothing(const std::string &text)
{
    Lines out;
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
            in = (line == "[Smoothing]");
            continue;
        }
        auto eq = line.find('=');
        if (in && eq != std::string::npos) out.emplace_back(line.substr(0, eq), line.substr(eq + 1));
    }
    return out;
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

// the number after the last '_' of a key of a region ("Mode_3" -> 3), 0 if the key is not one
int suffix(const std::string &key)
{
    auto u = key.rfind('_');
    if (u == std::string::npos || u + 1 >= key.size()) return 0;
    for (size_t i = u + 1; i < key.size(); ++i)
        if (key[i] < '0' || key[i] > '9') return 0;
    return std::atoi(key.c_str() + u + 1);
}

int regionCount(const Lines &l)
{
    int n = 0;
    for (auto &p : l) n = std::max(n, suffix(p.first));
    return n;
}

// the index of our region, 0 if none
int ourRegion(const Lines &l)
{
    for (int k = 1; k <= regionCount(l); ++k) {
        auto n = find(l, "MaskName_" + std::to_string(k)), m = find(l, "Mode_" + std::to_string(k));
        if (n && *n == REGION_NAME && m && *m == "7") return k;
    }
    return 0;
}

std::string num(double v)
{
    char buf[64];
    std::snprintf(buf, sizeof buf, "%.10g", v);
    return buf;
}

double number(const Lines &l, const std::string &key, double dflt)
{
    auto v = find(l, key);
    return v ? std::atof(v->c_str()) : dflt;
}

} // namespace

json state(const std::string &profileText)
{
    Lines l = smoothing(profileText);
    json r = {{"Enabled", false}, {"Strength", 1.0}, {"Tint", 0.0}};
    int k = ourRegion(l);
    if (!k) return r;
    const std::string n = std::to_string(k);
    auto en = find(l, "Enabled"), me = find(l, "MaskEnabled_" + n);
    r["Enabled"] = en && *en == "true" && !(me && *me == "false");
    r["Strength"] = number(l, "HalationSize_" + n, 1.0);
    r["Tint"] = number(l, "HalationColor_" + n, 0.0);
    return r;
}

std::string rewrite(const std::string &profileText, const json &change)
{
    if (!change.is_object()) throw std::invalid_argument("Halation: expected an object");
    for (auto &[k, v] : change.items()) {
        if (k == "Enabled") {
            if (!v.is_boolean()) throw std::invalid_argument("Halation Enabled: expected true or false");
        } else if (k == "Strength" || k == "Tint") {
            const double lo = k == "Strength" ? 0.001 : -0.5, hi = k == "Strength" ? 5 : 0.5;
            if (!v.is_number() || !std::isfinite(v.get<double>()) || v.get<double>() < lo || v.get<double>() > hi)
                throw std::invalid_argument("Halation " + k + ": out of range");
        } else {
            throw std::invalid_argument("Halation: unknown key " + k);
        }
    }

    Lines l = smoothing(profileText);
    const bool toolOn = [&] { auto e = find(l, "Enabled"); return e && *e == "true"; }();
    const int others = regionCount(l);
    int k = ourRegion(l);
    if (!k) {
        // after all the others; the new region is off until it is told otherwise
        k = others + 1;
        const std::string n = std::to_string(k);
        set(l, "Mode_" + n, "7");
        set(l, "MaskName_" + n, REGION_NAME);
        set(l, "MaskEnabled_" + n, "false");
        set(l, "HalationSize_" + n, "1");
        set(l, "HalationColor_" + n, "0");
    }
    const std::string n = std::to_string(k);
    if (change.contains("Strength")) set(l, "HalationSize_" + n, num(change["Strength"].get<double>()));
    if (change.contains("Tint")) set(l, "HalationColor_" + n, num(change["Tint"].get<double>()));
    if (change.contains("Enabled")) {
        const bool on = change["Enabled"].get<bool>();
        if (on) {
            if (!toolOn)  // the regions the sidecar has were off with the tool: they stay off
                for (int j = 1; j <= others; ++j)
                    if (j != k) set(l, "MaskEnabled_" + std::to_string(j), "false");
            set(l, "MaskEnabled_" + n, "true");
            set(l, "Enabled", "true");
        } else {
            set(l, "MaskEnabled_" + n, "false");
            bool another = false;
            for (int j = 1; j <= std::max(others, k); ++j) {
                if (j == k) continue;
                auto m = find(l, "MaskEnabled_" + std::to_string(j));
                another = another || !(m && *m == "false");
            }
            if (!another) set(l, "Enabled", "false");
        }
    } else if (!find(l, "Enabled")) {
        set(l, "Enabled", "false");
    }

    std::string out = "[Smoothing]\n";
    for (auto &p : l) out += p.first + "=" + p.second + "\n";
    return out + "\n";
}

}} // namespace mart::halation
