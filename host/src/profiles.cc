// SPDX-License-Identifier: GPL-3.0-or-later
#include "profiles.h"
#include <algorithm>
#include <cstdlib>
#include <dirent.h>
#include <fstream>
#include <stdexcept>
#include <sys/stat.h>

namespace mart {

namespace {

bool endsWith(const std::string &s, const std::string &e)
{
    return s.size() >= e.size() && s.compare(s.size() - e.size(), e.size(), e) == 0;
}

// *.arp files below `dir`, relative to it, at most 3 levels deep
void scan(const std::string &dir, const std::string &rel, int depth, std::vector<std::string> &out)
{
    DIR *d = opendir((rel.empty() ? dir : dir + "/" + rel).c_str());
    if (!d) return;
    while (dirent *e = readdir(d)) {
        std::string n = e->d_name;
        if (n.empty() || n[0] == '.') continue;
        std::string r = rel.empty() ? n : rel + "/" + n;
        struct stat st;
        if (stat((dir + "/" + r).c_str(), &st) != 0) continue;  // follows symlinks, as ART's folder does
        if (S_ISDIR(st.st_mode)) {
            if (depth < 3) scan(dir, r, depth + 1, out);
        } else if (S_ISREG(st.st_mode) && endsWith(n, ".arp")) {
            out.push_back(r);
        }
    }
    closedir(d);
}

std::string displayName(std::string rel)
{
    if (endsWith(rel, ".arp")) rel.resize(rel.size() - 4);
    return rel;
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

Profiles::Profiles(std::vector<ProfileDir> dirs, const std::string &uploadDir): dirs_(std::move(dirs)), uploadDir_(uploadDir) {}

nlohmann::json Profiles::list()
{
    nlohmann::json r = nlohmann::json::array();
    for (size_t i = 0; i < dirs_.size(); ++i) {
        std::vector<std::string> files;
        scan(dirs_[i].path, "", 0, files);
        std::sort(files.begin(), files.end());
        for (auto &f : files)
            r.push_back({{"id", "d" + std::to_string(i) + ":" + f}, {"name", displayName(f)}, {"source", dirs_[i].tag}});
    }
    for (auto &[id, name] : uploads_) r.push_back({{"id", id}, {"name", name}, {"source", "uploaded"}});
    return r;
}

nlohmann::json Profiles::upload(const std::string &name, const std::string &text)
{
    if (text.empty() || text.size() > (1u << 20)) throw std::invalid_argument("a profile is 1 byte to 1 MiB");
    if (text.find('\0') != std::string::npos) throw std::invalid_argument("not a text profile");
    // an .arp is an INI file: it must have at least one [Group] line
    bool group = false;
    size_t i = 0;
    while (i < text.size() && !group) {
        size_t j = text.find('\n', i);
        if (j == std::string::npos) j = text.size();
        group = j > i + 2 && text[i] == '[' && (text[j - 1] == ']' || (text[j - 1] == '\r' && text[j - 2] == ']'));
        i = j + 1;
    }
    if (!group) throw std::invalid_argument("this does not look like an ART profile (.arp)");
    std::string id = "u" + std::to_string(nextUpload_++);
    std::ofstream f(uploadDir_ + "/" + id + ".arp", std::ios::binary | std::ios::trunc);
    f << text;
    if (!f) throw std::runtime_error("cannot store the profile");
    // a display name: no path, no control characters
    std::string n;
    for (char c : name) n += (c == '/' || c == '\\' || static_cast<unsigned char>(c) < 32) ? '_' : c;
    n = displayName(n.substr(0, 80));
    if (n.empty()) n = "Uploaded profile";
    uploads_[id] = n;
    return {{"id", id}, {"name", n}, {"source", "uploaded"}};
}

std::string Profiles::path(const std::string &id) const
{
    if (uploads_.count(id)) return uploadDir_ + "/" + id + ".arp";
    if (id.size() < 3 || id[0] != 'd') return "";
    size_t colon = id.find(':');
    if (colon == std::string::npos) return "";
    char *end = nullptr;
    unsigned long k = std::strtoul(id.c_str() + 1, &end, 10);
    if (end != id.c_str() + colon || k >= dirs_.size()) return "";
    std::string rel = id.substr(colon + 1);
    if (!safeRelative(rel) || !endsWith(rel, ".arp")) return "";
    std::string p = dirs_[k].path + "/" + rel;
    struct stat st;
    return stat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode) ? p : "";
}

} // namespace mart
