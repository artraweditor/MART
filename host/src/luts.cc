// SPDX-License-Identifier: GPL-3.0-or-later
#include "luts.h"
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

// what ART's Film Simulation reads: CTL scripts, CLF, Hald CLUT images and OCIO descriptions
const char *const EXTENSIONS[] = {"ctl", "clf", "clfz", "png", "tif", "tiff", "jpg", "jpeg", "json"};

std::string lower(std::string s)
{
    for (auto &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

// the known extension of a file name (lower case, without the dot), "" if it has none
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

// a file name: no path, no control characters, nothing hidden
std::string safeFileName(const std::string &name)
{
    std::string n;
    for (char c : name) n += (c == '/' || c == '\\' || static_cast<unsigned char>(c) < 32) ? '_' : c;
    n = n.substr(0, 100);
    while (!n.empty() && (n[0] == '.' || n[0] == ' ')) n.erase(0, 1);
    return n;
}

void makeDirs(const std::string &dir)
{
    for (size_t i = 1; i <= dir.size(); ++i)
        if (i == dir.size() || dir[i] == '/') mkdir(dir.substr(0, i).c_str(), 0755);
}

// the characters that GLib leaves as they are in the path of a URI, like ART's Glib::filename_to_uri
std::string encode(const std::string &s)
{
    static const char *const hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c) || std::string("-._~!$&'()*+,;=:@/").find(static_cast<char>(c)) != std::string::npos) out += static_cast<char>(c);
        else { out += '%'; out += hex[c >> 4]; out += hex[c & 15]; }
    }
    return out;
}

std::string decode(const std::string &s)
{
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size() && std::isxdigit(static_cast<unsigned char>(s[i + 1])) && std::isxdigit(static_cast<unsigned char>(s[i + 2]))) {
            out += static_cast<char>(std::stoi(s.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else {
            out += s[i];
        }
    }
    return out;
}

} // namespace

Luts::Luts(std::string dir): dir_(std::move(dir)) {}

nlohmann::json Luts::list()
{
    nlohmann::json r = nlohmann::json::array();
    std::vector<std::string> files;
    scan(dir_, "", 0, files);
    // by name, ignoring case: "sigmoid" comes before "Teal"
    std::sort(files.begin(), files.end(), [](const std::string &a, const std::string &b) { return lower(a) != lower(b) ? lower(a) < lower(b) : a < b; });
    for (auto &f : files) r.push_back({{"id", "d0:" + f}, {"name", f}, {"source", "mine"}});
    return r;
}

nlohmann::json Luts::import(const std::string &fileName, const std::string &bytes)
{
    if (bytes.empty() || bytes.size() > MAX_IMPORT) throw std::invalid_argument("a LUT file is 1 byte to 64 MiB");
    const std::string n = safeFileName(fileName);
    if (extensionOf(n).empty()) throw std::invalid_argument("not a LUT: expected a .ctl, .clf, .png, .tif, .jpg or .json file");
    makeDirs(dir_);
    struct stat st;
    if (stat(dir_.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) throw std::invalid_argument("cannot make the folder for LUTs");
    const std::string path = dir_ + "/" + n;
    if (stat(path.c_str(), &st) == 0) throw ProfileExists("a LUT named \"" + n + "\" already exists");
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    f.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    f.close();
    if (!f) {
        std::remove(path.c_str());
        throw std::runtime_error("cannot store the LUT");
    }
    return {{"id", "d0:" + n}, {"name", n}, {"source", "mine"}};
}

nlohmann::json Luts::rename(const std::string &id, const std::string &newName)
{
    const std::string from = path(id);
    if (from.empty()) throw std::out_of_range("no such LUT");
    const std::string oldRel = id.substr(3);
    const std::string ext = oldRel.substr(oldRel.rfind('.'));   // with the dot: the format stays
    std::string stem = safeFileName(newName);
    if (lower(stem).size() >= ext.size() && lower(stem).compare(lower(stem).size() - ext.size(), ext.size(), lower(ext)) == 0)
        stem.resize(stem.size() - ext.size());
    stem = safeFileName(stem);
    if (stem.empty()) throw std::invalid_argument("give the LUT a name");
    const auto slash = oldRel.rfind('/');
    const std::string newRel = (slash == std::string::npos ? "" : oldRel.substr(0, slash + 1)) + stem + ext;
    const std::string to = dir_ + "/" + newRel;
    struct stat st;
    if (newRel != oldRel && lower(newRel) != lower(oldRel) && stat(to.c_str(), &st) == 0)
        throw ProfileExists("a LUT named \"" + stem + ext + "\" already exists");
    if (std::rename(from.c_str(), to.c_str()) != 0) throw std::runtime_error("cannot rename the LUT");
    return {{"id", "d0:" + newRel}, {"name", newRel}, {"source", "mine"}};
}

void Luts::remove(const std::string &id)
{
    const std::string file = path(id);
    if (file.empty()) throw std::out_of_range("no such LUT");
    if (unlink(file.c_str()) != 0) throw std::runtime_error("cannot delete the LUT");
}

std::string Luts::path(const std::string &id) const
{
    if (id.compare(0, 3, "d0:") != 0) return "";
    const std::string rel = id.substr(3);
    if (!safeRelative(rel) || extensionOf(rel).empty()) return "";
    std::string p = dir_ + "/" + rel;
    struct stat st;
    return stat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode) ? p : "";
}

std::string Luts::toUri(const std::string &path) const
{
    const std::string prefix = dir_ + "/";
    if (dir_.empty() || path.compare(0, prefix.size(), prefix) != 0) return "";
    const std::string rel = path.substr(prefix.size());
    return safeRelative(rel) ? "file://R/" + encode(rel) : "";
}

std::string Luts::fromUri(const std::string &s) const
{
    if (s.empty()) return "";
    if (s.compare(0, 7, "file://") != 0) return s[0] == '/' ? s : dir_ + "/" + s;
    const std::string rest = s.substr(7);
    const auto slash = rest.find('/');
    if (slash == std::string::npos) return "";
    const std::string host = rest.substr(0, slash), path = decode(rest.substr(slash));
    if (host.empty() || host == "localhost") return path;
    if (host == "R") return safeRelative(path.substr(1)) ? dir_ + path : "";
    if (host == "H") {
        const char *home = std::getenv("HOME");
        return home && safeRelative(path.substr(1)) ? std::string(home) + path : "";
    }
    return "";   // S, U, B: ART's own folders, which MART does not know
}

std::string Luts::resolveInProfile(const std::string &text) const
{
    std::string out;
    bool film = false;
    size_t i = 0;
    while (i < text.size()) {
        size_t j = text.find('\n', i);
        const size_t end = j == std::string::npos ? text.size() : j + 1;
        std::string line = text.substr(i, end - i);
        std::string bare = line;
        while (!bare.empty() && (bare.back() == '\n' || bare.back() == '\r')) bare.pop_back();
        if (!bare.empty() && bare[0] == '[') film = (bare == "[Film Simulation]");
        if (film && bare.compare(0, 13, "ClutFilename=") == 0) {
            const std::string v = bare.substr(13);
            // ART's R is relative to its own folder of LUTs: here it is MART's
            if (v.compare(0, 9, "file://R/") == 0 || (!v.empty() && v[0] != '/' && v.compare(0, 7, "file://") != 0)) {
                const std::string p = fromUri(v);
                if (!p.empty()) {
                    const std::string eol = line.substr(bare.size());   // the line ending, as it was
                    line = "ClutFilename=" + p + eol;
                }
            }
        }
        out += line;
        i = end;
    }
    return out;
}

} // namespace mart
