// SPDX-License-Identifier: GPL-3.0-or-later
#include "profiles.h"
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <dirent.h>
#include <fstream>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

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
    r.push_back({{"id", ":neutral"}, {"name", "Neutral"}, {"source", "builtin"}, {"default", false}});
    const std::string dflt = defaultRel();
    for (size_t i = 0; i < dirs_.size(); ++i) {
        std::vector<std::string> files;
        scan(dirs_[i].path, "", 0, files);
        std::sort(files.begin(), files.end());
        for (auto &f : files)
            r.push_back({{"id", "d" + std::to_string(i) + ":" + f}, {"name", displayName(f)}, {"source", dirs_[i].tag},
                         {"default", i == 0 && f == dflt}});
    }
    for (auto &[id, name] : uploads_) r.push_back({{"id", id}, {"name", name}, {"source", "uploaded"}, {"default", false}});
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
    return {{"id", id}, {"name", n}, {"source", "uploaded"}, {"default", false}};
}

std::string Profiles::path(const std::string &id) const
{
    if (isBuiltin(id)) return id;  // ART's own name: `apply :neutral`
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


std::string Profiles::sanitizeName(const std::string &name)
{
    std::string s = name;
    if (endsWith(s, ".arp")) s.resize(s.size() - 4);
    std::string out;
    for (unsigned char c : s) {
        const bool ok = std::isalnum(c) || c == '_' || c == '-' || c == '.' || c == ' ' || c == '(' || c == ')' || c >= 0x80;
        out += ok ? static_cast<char>(c) : '_';
        if (out.size() >= 80) break;
    }
    size_t a = out.find_first_not_of(" .");
    if (a == std::string::npos) return "";
    size_t b = out.find_last_not_of(" .");
    return out.substr(a, b - a + 1);
}

nlohmann::json Profiles::save(const std::string &name, const std::string &text, bool overwrite)
{
    if (dirs_.empty()) throw std::invalid_argument("there is no folder for profiles");
    const std::string stem = sanitizeName(name);
    if (stem.empty()) throw std::invalid_argument("give the profile a name");
    if (text.empty()) throw std::invalid_argument("there is nothing to save in the selected sections");
    const std::string dir = dirs_[0].path;
    // the folder (and its parent: ~/.config/MART) is made when the first profile is saved
    for (size_t i = 1; i <= dir.size(); ++i)
        if (i == dir.size() || dir[i] == '/') mkdir(dir.substr(0, i).c_str(), 0755);
    struct stat st;
    if (stat(dir.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) throw std::invalid_argument("cannot make the folder for profiles");
    const std::string file = stem + ".arp";
    const std::string path = dir + "/" + file;
    if (!overwrite && stat(path.c_str(), &st) == 0) throw ProfileExists("a profile named \"" + stem + "\" already exists");
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    f << text;
    f.close();
    if (!f) throw std::runtime_error("cannot write the profile");
    return {{"id", "d0:" + file}, {"name", stem}, {"source", dirs_[0].tag}, {"default", file == defaultRel()}};
}

namespace {
std::string lowerCase(std::string s)
{
    for (auto &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}
} // namespace

nlohmann::json Profiles::rename(const std::string &id, const std::string &newName)
{
    const std::string from = path(id);
    if (id.compare(0, 3, "d0:") != 0 || dirs_.empty()) throw std::invalid_argument("only a profile of MART's folder can be renamed");
    if (from.empty()) throw std::out_of_range("no such profile");
    const std::string stem = sanitizeName(newName);
    if (stem.empty()) throw std::invalid_argument("give the profile a name");
    // the new file is next to the old one (a profile in a subfolder stays there)
    const std::string oldRel = id.substr(3);
    const auto slash = oldRel.rfind('/');
    const std::string newRel = (slash == std::string::npos ? "" : oldRel.substr(0, slash + 1)) + stem + ".arp";
    const std::string to = dirs_[0].path + "/" + newRel;
    struct stat st;
    // on a file system that ignores case, "warm" -> "Warm" names the same file: that is a rename, not a clash
    if (newRel != oldRel && lowerCase(newRel) != lowerCase(oldRel) && stat(to.c_str(), &st) == 0)
        throw ProfileExists("a profile named \"" + stem + "\" already exists");
    if (std::rename(from.c_str(), to.c_str()) != 0) throw std::runtime_error("cannot rename the profile");
    if (defaultRel() == oldRel) {
        std::ofstream f(dirs_[0].path + "/.default", std::ios::binary | std::ios::trunc);
        f << newRel << "\n";
    }
    return {{"id", "d0:" + newRel}, {"name", stem}, {"source", dirs_[0].tag}, {"default", defaultRel() == newRel}};
}

void Profiles::remove(const std::string &id)
{
    const std::string file = path(id);
    if (id.compare(0, 3, "d0:") != 0 || dirs_.empty()) throw std::invalid_argument("only a profile of MART's folder can be deleted");
    if (file.empty()) throw std::out_of_range("no such profile");
    if (defaultRel() == id.substr(3)) unlink((dirs_[0].path + "/.default").c_str());
    if (unlink(file.c_str()) != 0) throw std::runtime_error("cannot delete the profile");
}

std::string Profiles::defaultRel() const
{
    if (dirs_.empty()) return "";
    std::ifstream f(dirs_[0].path + "/.default");
    std::string rel;
    std::getline(f, rel);
    while (!rel.empty() && (rel.back() == '\r' || rel.back() == '\n' || rel.back() == ' ')) rel.pop_back();
    return rel;
}

std::string Profiles::defaultPath() const
{
    const std::string rel = defaultRel();
    return rel.empty() ? "" : path("d0:" + rel);
}

void Profiles::setDefault(const std::string &id)
{
    if (dirs_.empty()) throw std::invalid_argument("there is no folder for profiles");
    const std::string file = dirs_[0].path + "/.default";
    if (id.empty()) {
        unlink(file.c_str());
        return;
    }
    if (id.compare(0, 3, "d0:") != 0 || path(id).empty()) throw std::invalid_argument("only a profile of the folder can be the default");
    std::ofstream f(file, std::ios::binary | std::ios::trunc);
    f << id.substr(3) << "\n";
    f.close();
    if (!f) throw std::runtime_error("cannot write the default");
}

} // namespace mart
