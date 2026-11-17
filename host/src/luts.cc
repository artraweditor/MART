// SPDX-License-Identifier: GPL-3.0-or-later
#include "luts.h"
#include <algorithm>
#include <cstdlib>
#include <dirent.h>
#include <fstream>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

namespace mart {

namespace {

// what ART's Film Simulation reads: CTL scripts, CLF, Hald CLUT images and OCIO descriptions
const char *const EXTENSIONS[] = {"ctl", "clf", "clfz", "png", "tif", "tiff", "jpg", "jpeg", "json"};

std::string lower(std::string s)
{
    for (auto &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string extensionOf(const std::string &name)
{
    auto dot = name.rfind('.');
    if (dot == std::string::npos || dot + 1 >= name.size()) return "";
    std::string e = lower(name.substr(dot + 1));
    for (auto x : EXTENSIONS)
        if (e == x) return e;
    return "";
}

void scan(const std::string &dir, const std::string &rel, int depth, std::vector<std::string> &out)
{
    DIR *d = opendir((rel.empty() ? dir : dir + "/" + rel).c_str());
    if (!d) return;
    while (dirent *e = readdir(d)) {
        std::string n = e->d_name;
        if (n.empty() || n[0] == '.') continue;
        std::string r = rel.empty() ? n : rel + "/" + n;
        struct stat st;
        if (stat((dir + "/" + r).c_str(), &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            if (depth < 3) scan(dir, r, depth + 1, out);
        } else if (S_ISREG(st.st_mode) && !extensionOf(n).empty()) {
            out.push_back(r);
        }
    }
    closedir(d);
}

bool safeRelative(const std::string &rel)
{
    if (rel.empty() || rel[0] == '/') return false;
    size_t i = 0;
    while (i <= rel.size()) {
        size_t j = rel.find('/', i);
        if (j == std::string::npos) j = rel.size();
        std::string part = rel.substr(i, j - i);
        if (part.empty() || part == "." || part == "..") return false;
        i = j + 1;
    }
    return true;
}

} // namespace

Luts::Luts(std::vector<ProfileDir> dirs, const std::string &uploadDir): dirs_(std::move(dirs)), uploadDir_(uploadDir) {}

nlohmann::json Luts::list()
{
    nlohmann::json r = nlohmann::json::array();
    for (size_t i = 0; i < dirs_.size(); ++i) {
        std::vector<std::string> files;
        scan(dirs_[i].path, "", 0, files);
        std::sort(files.begin(), files.end());
        for (auto &f : files) r.push_back({{"id", "d" + std::to_string(i) + ":" + f}, {"name", f}, {"source", dirs_[i].tag}});
    }
    for (auto &[id, name] : uploads_) r.push_back({{"id", id}, {"name", name}, {"source", "uploaded"}});
    return r;
}

nlohmann::json Luts::upload(const std::string &name, const std::string &bytes)
{
    if (bytes.empty() || bytes.size() > MAX_UPLOAD) throw std::invalid_argument("a LUT file is 1 byte to 64 MiB");
    // a display name: no path, no control characters, nothing hidden
    std::string n;
    for (char c : name) n += (c == '/' || c == '\\' || static_cast<unsigned char>(c) < 32) ? '_' : c;
    n = n.substr(0, 100);
    while (!n.empty() && n[0] == '.') n.erase(0, 1);
    if (extensionOf(n).empty())
        throw std::invalid_argument("not a LUT: expected a .ctl, .clf, .png, .tif, .jpg or .json file");
    const std::string id = "u" + std::to_string(nextUpload_++);
    // a folder per upload, so that the file keeps its own name (ART shows it, and finds the format by its extension)
    const std::string dir = uploadDir_ + "/" + id;
    if (mkdir(dir.c_str(), 0700) != 0) throw std::runtime_error("cannot store the LUT");
    std::ofstream f(dir + "/" + n, std::ios::binary | std::ios::trunc);
    f.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    f.close();
    if (!f) throw std::runtime_error("cannot store the LUT");
    uploads_[id] = n;
    return {{"id", id}, {"name", n}, {"source", "uploaded"}};
}

std::string Luts::path(const std::string &id) const
{
    auto u = uploads_.find(id);
    if (u != uploads_.end()) return uploadDir_ + "/" + id + "/" + u->second;
    if (id.size() < 3 || id[0] != 'd') return "";
    size_t colon = id.find(':');
    if (colon == std::string::npos) return "";
    char *end = nullptr;
    unsigned long k = std::strtoul(id.c_str() + 1, &end, 10);
    if (end != id.c_str() + colon || k >= dirs_.size()) return "";
    std::string rel = id.substr(colon + 1);
    if (!safeRelative(rel) || extensionOf(rel).empty()) return "";
    std::string p = dirs_[k].path + "/" + rel;
    struct stat st;
    return stat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode) ? p : "";
}

void Luts::clear()
{
    for (auto &[id, name] : uploads_) {
        unlink((uploadDir_ + "/" + id + "/" + name).c_str());
        rmdir((uploadDir_ + "/" + id).c_str());
    }
    uploads_.clear();
}

} // namespace mart
