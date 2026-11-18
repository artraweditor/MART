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

#include "retouch.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <utility>
#include <vector>

namespace mart {
namespace retouch {

const char *const NAME_PREFIX = "MART retouch ";

namespace {

using Lines = std::vector<std::pair<std::string, std::string>>;

// a region: its keys without the `_N` suffix, in order
struct Region {
    Lines kv;
    const std::string *find(const std::string &k) const
    {
        for (auto &p : kv)
            if (p.first == k) return &p.second;
        return nullptr;
    }
    void set(const std::string &k, const std::string &v)
    {
        for (auto &p : kv)
            if (p.first == k) {
                p.second = v;
                return;
            }
        kv.emplace_back(k, v);
    }
    bool on() const
    {
        auto m = find("MaskEnabled");
        return !(m && *m == "false");
    }
    // the id of our region (0 if it is not)
    int id() const
    {
        auto n = find("MaskName");
        const size_t L = std::strlen(NAME_PREFIX);
        if (!n || n->compare(0, L, NAME_PREFIX) != 0 || n->size() == L)
            return 0;
        for (size_t i = L; i < n->size(); ++i)
            if ((*n)[i] < '0' || (*n)[i] > '9') return 0;
        if (n->size() - L > 6) return 0;
        return std::atoi(n->c_str() + L);
    }
};

struct Group {
    Lines head;  // the keys of the tool itself (Enabled, ...)
    std::vector<Region> regions;
    bool toolOn() const
    {
        for (auto &p : head)
            if (p.first == "Enabled") return p.second == "true";
        return false;
    }
    void setTool(bool on)
    {
        for (auto &p : head)
            if (p.first == "Enabled") {
                p.second = on ? "true" : "false";
                return;
            }
        head.emplace_back("Enabled", on ? "true" : "false");
    }
};

// the number after the last '_' of a key (0 if there is none)
int suffix(const std::string &key)
{
    auto u = key.rfind('_');
    if (u == std::string::npos || u + 1 >= key.size()) return 0;
    for (size_t i = u + 1; i < key.size(); ++i)
        if (key[i] < '0' || key[i] > '9') return 0;
    return std::atoi(key.c_str() + u + 1);
}

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
            in = (line == "[ColorCorrection]");
            continue;
        }
        auto eq = line.find('=');
        if (!in || eq == std::string::npos) continue;
        std::string k = line.substr(0, eq), v = line.substr(eq + 1);
        const int n = suffix(k);
        if (n <= 0) {
            g.head.emplace_back(k, v);
            continue;
        }
        if (n > 1000) continue;
        if ((int)g.regions.size() < n) g.regions.resize(n);
        g.regions[n - 1].kv.emplace_back(k.substr(0, k.rfind('_')), v);
    }
    return g;
}

std::string serialize(const Group &g)
{
    std::string out = "[ColorCorrection]\n";
    for (auto &p : g.head) out += p.first + "=" + p.second + "\n";
    for (size_t k = 0; k < g.regions.size(); ++k)
        for (auto &p : g.regions[k].kv)
            out +=
                p.first + "_" + std::to_string(k + 1) + "=" + p.second + "\n";
    return out + "\n";
}

std::string num(double v)
{
    char buf[64];
    std::snprintf(buf, sizeof buf, "%.10g", v);
    return buf;
}

double number(const Region &r, const std::string &k, double dflt)
{
    auto v = r.find(k);
    return v && !v->empty() ? std::atof(v->c_str()) : dflt;
}

// ---- half floats and base64 -------------------------------------------------

uint16_t toHalf(float f)
{
    uint32_t x;
    std::memcpy(&x, &f, 4);
    const uint32_t sign = (x >> 16) & 0x8000;
    int32_t e = (int32_t)((x >> 23) & 0xff) - 127 + 15;
    uint32_t m = x & 0x7fffff;
    if (((x >> 23) & 0xff) == 0xff)
        return (uint16_t)(sign | 0x7c00 | (m ? 0x200 : 0));  // inf, nan
    if (e >= 31) return (uint16_t)(sign | 0x7c00);           // too large
    if (e <= 0) {  // subnormal or zero
        if (e < -10) return (uint16_t)sign;
        m |= 0x800000;
        const int shift = 14 - e;
        uint32_t h = m >> shift;
        const uint32_t rem = m & ((1u << shift) - 1), half = 1u << (shift - 1);
        if (rem > half || (rem == half && (h & 1))) ++h;
        return (uint16_t)(sign | h);
    }
    uint32_t h = ((uint32_t)e << 10) | (m >> 13);
    const uint32_t rem = m & 0x1fff;
    if (rem > 0x1000 || (rem == 0x1000 && (h & 1)))
        ++h;  // may carry into the exponent: right
    return (uint16_t)(sign | h);
}

float fromHalf(uint16_t h)
{
    const uint32_t sign = (uint32_t)(h & 0x8000) << 16;
    uint32_t e = (h >> 10) & 0x1f, m = h & 0x3ff, x;
    if (e == 0) {
        if (!m) {
            x = sign;
        } else {  // subnormal
            e = 127 - 15 + 1;
            while (!(m & 0x400)) {
                m <<= 1;
                --e;
            }
            m &= 0x3ff;
            x = sign | (e << 23) | (m << 13);
        }
    } else if (e == 31) {
        x = sign | 0x7f800000 | (m << 13);
    } else {
        x = sign | ((e - 15 + 127) << 23) | (m << 13);
    }
    float f;
    std::memcpy(&f, &x, 4);
    return f;
}

const char B64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64encode(const std::vector<uint8_t> &d)
{
    std::string o;
    for (size_t i = 0; i < d.size(); i += 3) {
        uint32_t v = d[i] << 16;
        if (i + 1 < d.size()) v |= d[i + 1] << 8;
        if (i + 2 < d.size()) v |= d[i + 2];
        o += B64[(v >> 18) & 63];
        o += B64[(v >> 12) & 63];
        o += i + 1 < d.size() ? B64[(v >> 6) & 63] : '=';
        o += i + 2 < d.size() ? B64[v & 63] : '=';
    }
    return o;
}

bool b64decode(const std::string &s, std::vector<uint8_t> &out)
{
    uint32_t acc = 0;
    int bits = 0;
    for (char c : s) {
        if (c == '=' || c == '\n' || c == '\r') continue;
        const char *p = std::strchr(B64, c);
        if (!c || !p) return false;
        acc = (acc << 6) | (uint32_t)(p - B64);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((uint8_t)((acc >> bits) & 0xff));
        }
    }
    return true;
}

}  // namespace

// the list ART stores: repeated [n, radius, paint, hardness, x1, y1, ... xn,
// yn]
std::string packStrokes(const json &groups)
{
    if (!groups.is_array())
        throw std::invalid_argument("Strokes: expected a list");
    std::vector<float> list;
    size_t total = 0;
    for (auto &g : groups) {
        if (!g.is_array() || g.size() < 5 || (g.size() - 3) % 2 != 0)
            throw std::invalid_argument("Strokes: bad group");
        for (auto &v : g)
            if (!v.is_number() || !std::isfinite(v.get<double>()))
                throw std::invalid_argument("Strokes: not a number");
        const double radius = g[0], paint = g[1], hard = g[2];
        if (radius < 0 || radius > 1 || (paint != 0 && paint != 1) ||
            hard < 0 || hard > 1)
            throw std::invalid_argument(
                "Strokes: bad radius, paint or hardness");
        const size_t n = (g.size() - 3) / 2;
        total += n;
        if (total > 200000) throw std::invalid_argument("Strokes: too many");
        for (size_t at = 0; at < n; at += 2048) {
            const size_t c =
                std::min<size_t>(2048, n - at);  // 2048 is the largest count a
                                                 // half float holds exactly
            list.push_back((float)c);
            list.push_back((float)radius);
            list.push_back((float)paint);
            list.push_back((float)hard);
            for (size_t i = at; i < at + c; ++i)
                for (int k = 0; k < 2; ++k) {
                    const double v = g[3 + 2 * i + k];
                    if (v < -0.5 || v > 1.5)
                        throw std::invalid_argument(
                            "Strokes: position out of the image");
                    list.push_back((float)v);
                }
        }
    }
    std::vector<uint8_t> bytes;
    for (float f : list) {
        const uint16_t h = toHalf(f);
        bytes.push_back(h & 0xff);
        bytes.push_back(h >> 8);
    }
    return b64encode(bytes);
}

json unpackStrokes(const std::string &packed)
{
    json out = json::array();
    std::vector<uint8_t> bytes;
    if (packed.empty() || !b64decode(packed, bytes)) return out;
    std::vector<float> v;
    for (size_t i = 0; i + 1 < bytes.size(); i += 2)
        v.push_back(fromHalf((uint16_t)(bytes[i] | (bytes[i + 1] << 8))));
    size_t i = 0;
    while (i + 4 <= v.size()) {
        const size_t n = (size_t)std::lround(v[i]);
        if (n == 0 || i + 4 + 2 * n > v.size()) break;
        json g = json::array();
        g.push_back(v[i + 1]);
        g.push_back((int)std::lround(v[i + 2]));
        g.push_back(v[i + 3]);
        for (size_t k = 0; k < 2 * n; ++k) g.push_back(v[i + 4 + k]);
        out.push_back(std::move(g));
        i += 4 + 2 * n;
    }
    return out;
}

namespace {

json regionState(const Region &r, bool toolOn)
{
    json j;
    j["Enabled"] = toolOn && r.on();
    j["HueShift"] = number(r, "HueShift", 0);
    j["OutSaturation"] = number(r, "OutSaturation", 0);
    j["Slope"] = number(r, "Slope", 1);
    j["Offset"] = number(r, "Offset", 0);
    j["Power"] = number(r, "Power", 1);
    j["Pivot"] = number(r, "Pivot", 1);
    j["Compression"] = number(r, "Compression", 0);
    auto b = r.find("DrawnMaskEnabled");
    j["BrushEnabled"] = b && *b == "true";
    j["BrushFeather"] = number(r, "DrawnMaskFeather", 0);
    j["BrushOpacity"] =
        std::round(number(r, "DrawnMaskOpacity", 1) * 1000) / 10;
    j["BrushSmoothness"] =
        std::round(number(r, "DrawnMaskSmoothness", 0) * 1000) / 10;
    auto s = r.find("DrawnMaskStrokes");
    j["Strokes"] = unpackStrokes(s ? *s : "");
    return j;
}

Region newRegion(int id)
{
    Region r;
    r.set("Mode", "Jzazbz");
    r.set("MaskName", NAME_PREFIX + std::to_string(id));
    r.set("MaskEnabled", "true");
    for (const char *k : {"Slope", "Pivot"}) r.set(k, "1");
    for (const char *k : {"Offset", "Compression", "HueShift", "OutSaturation",
                          "InSaturation", "A", "B"})
        r.set(k, "0");
    r.set("Power", "1");
    r.set("DrawnMaskEnabled", "false");
    r.set("DrawnMaskMode", "0");  // intersect: the brush is the only mask
    r.set("DrawnMaskFeather", "0");
    r.set("DrawnMaskOpacity", "1");
    r.set("DrawnMaskSmoothness", "0");
    r.set("DrawnMaskStrokes", "");
    return r;
}

struct Range {
    const char *key, *field;
    double lo, hi, scale;  // the key is the field's value times `scale`
};
const Range RANGES[] = {
    {"HueShift", "HueShift", -180, 180, 1},
    {"OutSaturation", "OutSaturation", -100, 100, 1},
    {"Slope", "Slope", 0.01, 32, 1},
    {"Offset", "Offset", -0.15, 0.15, 1},
    {"Power", "Power", 0.1, 4, 1},
    {"Pivot", "Pivot", 0.001, 2, 1},
    {"Compression", "Compression", 0, 1, 1},
    {"DrawnMaskFeather", "BrushFeather", 0, 100, 1},
    {"DrawnMaskOpacity", "BrushOpacity", 0, 100, 0.01},
    {"DrawnMaskSmoothness", "BrushSmoothness", 0, 100, 0.01},
};

bool validId(const std::string &s, int &id)
{
    if (s.empty() || s.size() > 4) return false;
    for (char c : s)
        if (c < '0' || c > '9') return false;
    id = std::atoi(s.c_str());
    return id >= 1;
}

}  // namespace

json state(const std::string &profileText)
{
    json out = json::object();
    Group g = parse(profileText);
    const bool on = g.toolOn();
    for (auto &r : g.regions)
        if (int id = r.id()) out[std::to_string(id)] = regionState(r, on);
    return out;
}

bool present(const std::string &profileText)
{
    for (auto &r : parse(profileText).regions)
        if (r.id()) return true;
    return false;
}

std::string rewrite(const std::string &profileText, const json &change)
{
    if (!change.is_object())
        throw std::invalid_argument("Retouch: expected an object");
    // check everything first: nothing is changed by a bad request
    for (auto &[ids, v] : change.items()) {
        int id;
        if (!validId(ids, id))
            throw std::invalid_argument("Retouch: bad region id " + ids);
        if (v.is_null()) continue;
        if (!v.is_object())
            throw std::invalid_argument("Retouch " + ids +
                                        ": expected an object or null");
        for (auto &[k, x] : v.items()) {
            if (k == "Enabled" || k == "BrushEnabled") {
                if (!x.is_boolean())
                    throw std::invalid_argument("Retouch " + k +
                                                ": expected true or false");
            } else if (k == "Strokes") {
                packStrokes(x);
            } else {
                const Range *r = nullptr;
                for (auto &c : RANGES)
                    if (k == c.field) r = &c;
                if (!r)
                    throw std::invalid_argument("Retouch: unknown key " + k);
                if (!x.is_number() || !std::isfinite(x.get<double>()) ||
                    x.get<double>() < r->lo || x.get<double>() > r->hi)
                    throw std::invalid_argument("Retouch " + k +
                                                ": out of range");
            }
        }
    }

    Group g = parse(profileText);
    const bool toolOn = g.toolOn();
    auto indexOf = [&](int id) {
        for (size_t i = 0; i < g.regions.size(); ++i)
            if (g.regions[i].id() == id) return (int)i;
        return -1;
    };
    std::vector<int> enabling;  // ids that are switched on by this change
    bool switchedOff = false;
    for (auto &[ids, v] : change.items()) {
        const int id = std::atoi(ids.c_str());
        int at = indexOf(id);
        if (v.is_null()) {
            if (at >= 0) {
                g.regions.erase(g.regions.begin() + at);
                switchedOff = true;
            }
            continue;
        }
        if (at < 0) {
            g.regions.push_back(newRegion(id));
            at = (int)g.regions.size() - 1;
            g.regions[at].set("MaskEnabled",
                              "false");  // on only if the change says so
        }
        Region &r = g.regions[at];
        for (auto &[k, x] : v.items()) {
            if (k == "Enabled") {
                r.set("MaskEnabled", x.get<bool>() ? "true" : "false");
                if (x.get<bool>())
                    enabling.push_back(id);
                else
                    switchedOff = true;
            } else if (k == "BrushEnabled") {
                r.set("DrawnMaskEnabled", x.get<bool>() ? "true" : "false");
                r.set("DrawnMaskMode", "0");
            } else if (k == "Strokes") {
                r.set("DrawnMaskStrokes", packStrokes(x));
            } else {
                for (auto &c : RANGES)
                    if (k == c.field)
                        r.set(c.key, num(x.get<double>() * c.scale));
            }
        }
    }
    if (!enabling.empty()) {
        if (!toolOn)  // the regions that the image has were off with the tool:
                      // they stay off
            for (auto &r : g.regions)
                if (std::find(enabling.begin(), enabling.end(), r.id()) ==
                    enabling.end())
                    r.set("MaskEnabled", "false");
        g.setTool(true);
    } else if (switchedOff) {
        bool another = false;
        for (auto &r : g.regions) another = another || r.on();
        if (!another) g.setTool(false);
    } else if (g.head.empty()) {
        g.setTool(false);
    }
    return serialize(g);
}

std::string profileText(const std::string &paramsText)
{
    Group g = parse(paramsText);
    const bool on = g.toolOn();
    Group out;
    out.setTool(true);
    for (auto &r : g.regions) {
        if (!r.id()) continue;
        Region c = r;
        c.set("MaskEnabled", on && r.on() ? "true" : "false");
        out.regions.push_back(std::move(c));
    }
    return out.regions.empty() ? "" : serialize(out);
}

std::string withoutColorCorrection(const std::string &profileText)
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
            skip = (line == "[ColorCorrection]");
        if (!skip) out += profileText.substr(i, end - i);
        i = end;
    }
    return out;
}

std::string replace(const std::string &paramsText,
                    const std::string &profileText)
{
    Group image = parse(paramsText), prof = parse(profileText);
    const bool toolOn = image.toolOn();
    Group out;
    out.head = image.head;
    for (auto &r : image.regions)
        if (!r.id()) out.regions.push_back(r);
    bool ours = false;
    for (auto &r : prof.regions)
        if (r.id()) {
            ours = ours || r.on();
            out.regions.push_back(r);
        }
    if (ours && !toolOn)  // the regions that the image has were off with the
                          // tool: they stay off
        for (auto &r : out.regions)
            if (!r.id()) r.set("MaskEnabled", "false");
    bool any = false;
    for (auto &r : out.regions) any = any || r.on();
    out.setTool(ours || (toolOn && any));
    return serialize(out);
}

}  // namespace retouch
}  // namespace mart
