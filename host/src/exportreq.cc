// SPDX-License-Identifier: GPL-3.0-or-later
#include "exportreq.h"
#include <algorithm>
#include <cmath>
#include <set>

namespace mart {

namespace {

bool endsWithNoCase(const std::string &s, const std::string &e)
{
    if (s.size() < e.size()) return false;
    for (size_t i = 0; i < e.size(); ++i)
        if (std::tolower(static_cast<unsigned char>(s[s.size() - e.size() + i])) != e[i]) return false;
    return true;
}

} // namespace

std::string sanitizeStem(const std::string &name)
{
    std::string s = name;
    for (const char *ext : {".jpg", ".jpeg", ".png", ".tif", ".tiff"})
        if (endsWithNoCase(s, ext)) {
            s.resize(s.size() - std::string(ext).size());
            break;
        }
    std::string out;
    for (unsigned char c : s) {
        const bool ok = std::isalnum(c) || c == '_' || c == '-' || c == '.' || c == ' ' || c == '(' || c == ')' || c >= 0x80;
        out += ok ? static_cast<char>(c) : '_';
        if (out.size() >= 120) break;
    }
    // no hidden or dotted-away names, no leading or trailing blanks
    size_t a = out.find_first_not_of(" .");
    if (a == std::string::npos) return "";
    size_t b = out.find_last_not_of(" .");
    return out.substr(a, b - a + 1);
}

std::string exportExtension(const std::string &f) { return f; }

std::string exportMimeType(const std::string &f)
{
    return f == "jpg" ? "image/jpeg" : f == "png" ? "image/png" : "image/tiff";
}

ExportRequest parseExportRequest(const nlohmann::json &body, const std::string &defaultStem)
{
    if (!body.is_object()) throw ExportRequestError("expected an object");
    static const std::set<std::string> known = {"format", "quality", "bits", "float", "compression", "name"};
    for (auto &[k, v] : body.items())
        if (!known.count(k)) throw ExportRequestError("unknown option: " + k);

    ExportRequest r;
    if (body.contains("format")) {
        if (!body["format"].is_string()) throw ExportRequestError("format must be a string");
        r.format = body["format"];
    }
    if (r.format != "jpg" && r.format != "png" && r.format != "tif") throw ExportRequestError("format must be jpg, png or tif");

    auto integer = [&](const char *key, long long lo, long long hi) -> long long {
        const auto &v = body[key];
        if (!v.is_number_integer() || v.get<long long>() < lo || v.get<long long>() > hi)
            throw ExportRequestError(std::string(key) + " must be an integer from " + std::to_string(lo) + " to " + std::to_string(hi));
        return v.get<long long>();
    };
    if (body.contains("quality")) {
        if (r.format != "jpg") throw ExportRequestError("quality applies to jpg only");
        r.quality = static_cast<int>(integer("quality", 1, 100));
    }
    if (body.contains("bits")) {
        const long long b = integer("bits", 1, 64);
        const bool ok = (r.format == "png" && (b == 8 || b == 16)) || (r.format == "tif" && (b == 8 || b == 16 || b == 32));
        if (r.format == "jpg") throw ExportRequestError("bits applies to png and tif only");
        if (!ok) throw ExportRequestError(r.format == "png" ? "png bits must be 8 or 16" : "tif bits must be 8, 16 or 32");
        r.bits = static_cast<int>(b);
    }
    if (body.contains("float")) {
        if (!body["float"].is_boolean()) throw ExportRequestError("float must be true or false");
        r.halfFloat = body["float"];
        if (r.halfFloat && (r.format != "tif" || r.bits != 16)) throw ExportRequestError("float needs tif with 16 bits");
    }
    if (body.contains("compression")) {
        if (r.format != "tif") throw ExportRequestError("compression applies to tif only");
        if (!body["compression"].is_string() || (body["compression"] != "none" && body["compression"] != "zip"))
            throw ExportRequestError("compression must be none or zip");
        r.compression = body["compression"];
    }
    if (body.contains("name")) {
        if (!body["name"].is_string()) throw ExportRequestError("name must be a string");
        r.stem = sanitizeStem(body["name"]);
    }
    if (r.stem.empty()) r.stem = sanitizeStem(defaultStem);
    if (r.stem.empty()) r.stem = "export";
    return r;
}

std::vector<std::string> exportArgs(const ExportRequest &r, const std::string &outfile)
{
    std::vector<std::string> a = {"export", outfile, "--format", r.format};
    if (r.format == "jpg") a.insert(a.end(), {"--quality", std::to_string(r.quality)});
    if (r.bits) a.insert(a.end(), {"--bits", std::to_string(r.bits)});
    if (r.halfFloat) a.push_back("--float");
    if (!r.compression.empty()) a.insert(a.end(), {"--compression", r.compression});
    return a;
}

} // namespace mart
