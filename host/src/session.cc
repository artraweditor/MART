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

#include <algorithm>
#include "session.h"
#include "arp.h"
#include "halation.h"
#include "localcontrast.h"
#include "tempdir.h"
#include "retouch.h"
#include "icctag.h"
#include "sections.h"
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

// set at build time (CMake: -DMART_VERSION=...); the default is for builds that do not go through CMake
#ifndef MART_VERSION
#define MART_VERSION "0.1.0"
#endif

namespace mart {

namespace {
std::string slurp(const std::string &p)
{
    std::ifstream f(p, std::ios::binary | std::ios::ate);
    std::string s;
    if (!f) return s;
    s.resize(static_cast<size_t>(f.tellg()));
    f.seekg(0);
    f.read(s.data(), static_cast<std::streamsize>(s.size()));
    return s;
}
}  // namespace

Session::Session(const EngineOptions &o, std::vector<std::string> roots,
                 std::vector<ProfileDir> profileDirs, std::string lutDir) :
    opts_(o), roots_(std::move(roots)), tmpdir_(makeTempDir("mart-")),
    profiles_(std::move(profileDirs)), luts_(std::move(lutDir))
{
    engine_ = Engine::create(o);
    version_ = nullptr;
}

Session::~Session()
{
    engine_.reset();
    unlink((tmpdir_ + "/preview.jpg").c_str());
    unlink((tmpdir_ + "/patch.arp").c_str());
    unlink((tmpdir_ + "/defaults.arp").c_str());
    unlink((tmpdir_ + "/profile.arp").c_str());
    unlink((tmpdir_ + "/export.arp").c_str());
    rmdir(tmpdir_.c_str());
}

json Session::command(const std::vector<std::string> &argv)
{
    Result r;
    try {
        r = engine_->run(argv);
    } catch (const ArtError &e) {
        throw ApiError(503, e.what());
    }
    json doc = json::parse(r.out, nullptr, false);
    if (!r.ok()) {
        std::string msg = doc.is_object() && doc.contains("error")
                              ? doc["error"].get<std::string>()
                              : r.err;
        throw ApiError(422, msg.empty() ? "the command failed" : msg);
    }
    if (doc.is_discarded())
        throw ApiError(502,
                       "unexpected reply from ART: " + r.out.substr(0, 200));
    return doc.contains("result") ? doc["result"] : json::object();
}

bool Session::underRoot(const std::string &p) const
{
    std::vector<std::string> roots;
    {
        std::lock_guard<std::mutex> g(rootsMutex_);
        roots = roots_;
    }
    for (auto root : roots) {
        char *rr = realpath(root.c_str(), nullptr);
        if (!rr) continue;
        std::string r = rr;
        free(rr);
        if (p == r || p.compare(0, r.size() + 1, r + "/") == 0) return true;
    }
    return false;
}

std::string Session::confine(const std::string &path) const
{
    char *rp = realpath(path.c_str(), nullptr);
    if (!rp) throw ApiError(404, "no such file: " + path);
    std::string p = rp;
    free(rp);
    if (underRoot(p)) return p;
    throw ApiError(403, "the file is not under an allowed root");
}

std::string Session::exportFolder(const std::string &dir) const
{
    const std::string d = confine(dir);
    struct stat st;
    if (stat(d.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) throw ApiError(400, "not a folder: " + dir);
    if (access(d.c_str(), W_OK) != 0) throw ApiError(403, "cannot write to the folder: " + dir);
    return d;
}

void Session::addRoot(const std::string &dir)
{
    std::lock_guard<std::mutex> g(rootsMutex_);
    for (auto &r : roots_)
        if (r == dir) return;
    roots_.push_back(dir);
}

namespace {
// what ART can open as an image
bool isImageName(const std::string &name)
{
    static const char *const exts[] = {
        "arw", "srf", "sr2", "cr2", "cr3", "crw", "nef", "nrw", "orf", "raf",
        "rw2", "rwl", "pef", "dng", "srw", "3fr", "erf", "mef", "mos", "kdc",
        "dcr", "x3f", "iiq", "fff", "cap", "mrw", "raw", "gpr", "jpg", "jpeg",
        "tif", "tiff", "png"};
    auto dot = name.rfind('.');
    if (dot == std::string::npos || name[0] == '.') return false;
    std::string e = name.substr(dot + 1);
    for (auto &ch : e) ch = static_cast<char>(std::tolower(ch));
    for (auto x : exts)
        if (e == x) return true;
    return false;
}
}  // namespace

json Session::listImages(const std::string &dir) const
{
    json dirs = json::array();
    if (dir.empty()) {  // the roots
        std::vector<std::string> roots;
        {
            std::lock_guard<std::mutex> g(rootsMutex_);
            roots = roots_;
        }
        for (auto &root : roots) {
            char *rr = realpath(root.c_str(), nullptr);
            if (!rr) continue;
            const std::string r = rr;
            free(rr);
            struct stat st;
            if (stat(r.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            bool seen = false;
            for (auto &x : dirs) seen = seen || x["path"] == r;
            if (!seen) dirs.push_back({{"name", r}, {"path", r}});
        }
        return {{"dir", ""}, {"parent", ""}, {"dirs", dirs}, {"images", json::array()}};
    }
    const std::string d = confine(dir);
    DIR *dp = opendir(d.c_str());
    if (!dp) throw ApiError(404, "cannot read the folder: " + dir);
    json images = json::array();
    while (dirent *e = readdir(dp)) {
        const std::string name = e->d_name;
        const std::string path = d + "/" + name;
        struct stat st;
        if (name[0] != '.' && stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) {
            dirs.push_back({{"name", name}, {"path", path}});
            continue;
        }
        if (!isImageName(name)) continue;
        if (stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) continue;
        struct stat sc;
        images.push_back({{"name", name},
                          {"path", path},
                          {"size", static_cast<long long>(st.st_size)},
                          {"mtime", static_cast<long long>(st.st_mtime)},
                          {"edited", stat((path + ".arp").c_str(), &sc) == 0}});
    }
    closedir(dp);
    auto byName = [](const json &a, const json &b) {
        return a["name"].get<std::string>() < b["name"].get<std::string>();
    };
    std::sort(images.begin(), images.end(), byName);
    std::sort(dirs.begin(), dirs.end(), byName);
    // the folder above, if it may be browsed too
    std::string parent;
    const auto slash = d.rfind('/');
    if (slash != std::string::npos && slash > 0 && underRoot(d.substr(0, slash))) parent = d.substr(0, slash);
    return {{"dir", d}, {"parent", parent}, {"dirs", dirs}, {"images", images}};
}

json Session::status() const
{
    json s;
    s["version"] = MART_VERSION;
    s["art_version"] = Engine::version();
    s["backend"] = opts_.inprocess ? "inprocess" : "remote";
    s["open"] = file_.empty() ? json(nullptr) : json{{"file", file_}};
    s["dirty"] = dirty_;
    s["busy"] = nullptr;
    return s;
}

// What is applied when an image is opened, as the start of its history (not as
// edits: they cannot be undone and the image is not "unsaved"):
// - a picture that has no sidecar starts from the neutral profile, not from
// what ART would load for it (its default
//   or dynamic profile): MART has its own profiles;
// - a DNG made by a phone can carry a flat field (gain maps) that corrects its
// vignetting: using it is on by default,
//   unless the sidecar says otherwise. Other raws have none to use, so nothing
//   is written for them;
// - the default profile, if one was chosen, for a picture that has no sidecar.
// In this order: the neutral profile resets everything, and the default profile
// can say otherwise about the flat field.
void Session::applyOpeningDefaults()
{
    base_ = 0;
    struct stat st;
    const bool hasSidecar = stat((file_ + ".arp").c_str(), &st) == 0;
    if (!hasSidecar) command({"apply", ":neutral"});
    if (defaults_.is_null()) {
        // the parameters of the neutral profile, once: the Other tab lists what
        // a profile changes that has no controls. With a sidecar the neutral
        // profile is applied just for this, and the sidecar again after it.
        if (hasSidecar) command({"apply", ":neutral"});
        defaults_ = arp::parse(command({"get-params"}).value("params", ""));
        if (hasSidecar) command({"apply", file_ + ".arp"});
    }
    std::string lower = file_;
    for (auto &c : lower)
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (info_.value("is_raw", false) && lower.size() >= 4 &&
        lower.compare(lower.size() - 4, 4, ".dng") == 0) {
        std::ifstream side(file_ + ".arp", std::ios::binary);
        std::stringstream text;
        text << side.rdbuf();
        if (text.str().find("FlatFieldUseEmbedded") ==
            std::string::npos) {  // else: a choice of the user
            const std::string path = tmpdir_ + "/defaults.arp";
            {
                std::ofstream f(path, std::ios::binary | std::ios::trunc);
                f << "[RAW]\nFlatFieldEnabled=true\nFlatFieldUseEmbedded="
                     "true\n";
                if (!f) throw ApiError(500, "cannot write " + path);
            }
            command({"apply", path});
        }
    }
    if (!hasSidecar) {
        const std::string profile = profiles_.defaultPath();
        if (!profile.empty()) {
            try {
                applyProfileFile(profile, false, "default#1");
            } catch (const ApiError &) {
                // a profile that ART does not accept must not keep the image
                // from opening
            }
        }
    }
    // the first entry of the history that the user can go back to: where the
    // defaults left it
    base_ = command({"get-history"}).value("selected", 0);
}

json Session::open(const std::string &path, bool discard)
{
    std::string p = confine(path);
    if (dirty_ && !discard) throw ApiError(409, "the image has unsaved edits");
    command({"open", p});
    file_ = p;
    dirty_ = false;
    info_ = command({"get-info"});
    applyOpeningDefaults();
    return info_;
}

void Session::refreshInfo()
{
    json i = command({"get-info"});
    info_ = i;
}

json Session::info()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    return info_;
}

json Session::version()
{
    if (version_.is_null()) {
        version_ = command({"get-version"});
    }
    return version_;
}

PreviewFrame Session::preview(const PreviewRequest &rq)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    const int fw = info_.value("full_width", 0),
              fh = info_.value("full_height", 0);
    int x = rq.x, y = rq.y, w = rq.w, h = rq.h;
    // a view of the old geometry (before a rotation, say) may not fit the image
    // any more: show it all
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > fw || y + h > fh)
        x = y = 0, w = fw, h = fh;
    const bool whole = (x == 0 && y == 0 && w == fw && h == fh);
    double scale = rq.scale;
    if (scale <= 0) scale = rq.out_w > 0 ? double(rq.out_w) / w : 1.0;
    if (!(scale > 0) || scale > 4) throw ApiError(400, "invalid scale");
    const std::string file = tmpdir_ + "/preview.jpg";
    std::vector<std::string> a = {"preview", file, "--scale",
                                  std::to_string(scale)};
    if (!whole)
        a.insert(a.end(),
                 {"--crop", std::to_string(x) + "," + std::to_string(y) + "," +
                                std::to_string(w) + "," + std::to_string(h)});
    json r = command(a);
    PreviewFrame f;
    f.width = r.value("width", 0);
    f.height = r.value("height", 0);
    f.x = x, f.y = y, f.w = w, f.h = h;
    f.jpeg = slurp(file);
    if (f.jpeg.empty()) throw ApiError(502, "ART wrote no preview");
    // `preview` always renders in sRGB (whatever the output, working or monitor
    // profile) but embeds no profile: say so, so that a browser or a screen
    // with another profile (a wide gamut one) converts the colours instead of
    // showing them raw. This needs an ART in which the preview is always sRGB
    // (see the README).
    f.jpeg = tagAsSRGB(f.jpeg);
    return f;
}

std::string Session::thumbnail(const std::string &path, int size)
{
    const std::string in = confine(path);
    if (size < 16 || size > 2048) throw ApiError(400, "invalid size");
    const std::string file = tmpdir_ + "/thumb.jpg";  // one at a time: the worker thread
    std::remove(file.c_str());
    command({"thumbnail", in, file, std::to_string(size), "--no-profile"});
    std::string jpeg = slurp(file);
    std::remove(file.c_str());
    if (jpeg.empty()) throw ApiError(502, "ART wrote no thumbnail");
    return tagAsSRGB(jpeg);  // like the preview: sRGB, but without a profile
}

json Session::params()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json r = command({"get-params"});
    std::string ini = r.value("params", "");
    json doc = arp::parse(ini);
    doc["Halation"] =
        halation::state(ini);  // not a group of the profile: MART's own view of
                               // one of the Smoothing regions
    doc["LocalContrast"] = localcontrast::state(
        ini);  // likewise: one region of the Local Contrast tool
    if (!defaults_.is_null())
        doc["Defaults"] = defaults_;  // what the neutral profile has, to tell
                                      // what a profile changes
    doc["Retouch"] = retouch::state(
        ini);  // likewise: our regions of the Color/tone correction tool, by id
    return {{"params", doc}, {"ini", ini}};
}

json Session::lutParams(const std::string &id)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    std::string path;
    if (!id.empty()) {
        path = luts_.path(
            id);  // a LUT that was just chosen: the profile may not have it yet
        if (path.empty()) throw ApiError(404, "no such LUT");
    } else {
        json p = arp::parse(command({"get-params"}).value("params", ""));
        path = p.contains("Film Simulation")
                   ? p["Film Simulation"].value("ClutFilename", "")
                   : "";
    }
    json r = {{"params", json::array()}, {"presets", json::array()}};
    if (path.empty()) return r;
    path = luts_.fromUri(path);  // what the profile says (a URI, with the R
                                 // host for the LUTs of MART's folder)
    try {
        r = command({"get-clut-params", path});
    } catch (const ApiError &e) {
        r["error"] = e.what();  // the file may not be on this machine (a
                                // relative or foreign path in the sidecar)
    }
    return r;
}

void Session::applyPatch(const json &patchIn, const std::string &mergeKey)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json patch = patchIn;
    json halationChange, retouchChange, lcChange;
    if (patch.is_object() && patch.contains("LocalContrast")) {
        lcChange = patch["LocalContrast"];
        patch.erase("LocalContrast");
    }
    if (patch.is_object() && patch.contains("Halation")) {
        halationChange = patch["Halation"];
        patch.erase("Halation");
    }
    if (patch.is_object() && patch.contains("Retouch")) {
        retouchChange = patch["Retouch"];
        patch.erase("Retouch");
    }
    auto apply = [&](const std::string &text) {
        const std::string path = tmpdir_ + "/patch.arp";
        {
            std::ofstream f(path, std::ios::binary | std::ios::trunc);
            f << text;
            if (!f) throw ApiError(500, "cannot write " + path);
        }
        std::vector<std::string> a = {"apply"};
        if (!mergeKey.empty()) a.insert(a.end(), {"--merge", mergeKey});
        a.push_back(path);
        command(a);
        dirty_ = true;
    };
    if ((halationChange.is_null() && retouchChange.is_null() &&
         lcChange.is_null()) ||
        !patch.empty()) {
        std::string text;
        try {
            text = arp::serialize(patch, [this](const std::string &id) {
                std::string p = luts_.path(id);
                if (p.empty()) throw arp::PatchError("no such LUT");
                return p;
            });
        } catch (const arp::PatchError &e) {
            throw ApiError(400, e.what());
        }
        apply(text);
    }
    if (!halationChange.is_null()) {
        std::string text;
        try {
            text = halation::rewrite(
                command({"get-params"}).value("params", ""), halationChange);
        } catch (const std::invalid_argument &e) {
            throw ApiError(400, e.what());
        }
        apply(text);
    }
    if (!lcChange.is_null()) {
        std::string text;
        try {
            text = localcontrast::rewrite(
                command({"get-params"}).value("params", ""), lcChange);
        } catch (const std::invalid_argument &e) {
            throw ApiError(400, e.what());
        }
        apply(text);
    }
    if (!retouchChange.is_null()) {
        std::string text;
        try {
            text = retouch::rewrite(command({"get-params"}).value("params", ""),
                                    retouchChange);
        } catch (const std::invalid_argument &e) {
            throw ApiError(400, e.what());
        }
        apply(text);
    }
    if (patch.contains("Coarse Transformation")) refreshInfo();
}

json Session::undo()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json h = command({"get-history"});
    if (h.value("selected", 0) <= base_)
        return {{"selected",
                 h.value("selected", 0)}};  // at the start: nothing to undo
    json r = command({"undo"});
    dirty_ = true;
    refreshInfo();
    return r;
}

json Session::redo()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json r = command({"redo"});
    dirty_ = true;
    refreshInfo();
    return r;
}

json Session::history()
{
    json h = command({"get-history"});
    int sel = h.value("selected", -1);
    int count = h.contains("entries") ? int(h["entries"].size()) : 0;
    return {{"selected", sel},
            {"count", count},
            {"can_undo", sel > base_},
            {"can_redo", sel >= 0 && sel + 1 < count}};
}

json Session::save()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json r = command({"save"});
    dirty_ = false;
    return r;
}

std::string Session::fileStem() const
{
    if (file_.empty()) return "";
    std::string n = file_.substr(file_.rfind('/') + 1);
    auto dot = n.rfind('.');
    return dot == std::string::npos || dot == 0 ? n : n.substr(0, dot);
}

json Session::exportImage(const std::vector<std::string> &args)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    // Exports are always sRGB, like the preview (and what a phone expects),
    // whatever the output profile of the image is. `--profile` overrides the
    // settings for this export only: the image, its history and its sidecar are
    // not touched. The intent and black point compensation are those of the
    // preview.
    const std::string path = tmpdir_ + "/export.arp";
    {
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        f << "[Color "
             "Management]\nOutputBPC=true\nOutputProfile=RTv2_"
             "sRGB\nOutputProfileIntent=Relative\n";
        if (!f) throw ApiError(500, "cannot write " + path);
    }
    std::vector<std::string> a = args;
    a.insert(a.end(), {"--profile", path});
    return command(a);
}

json Session::exportFormats() { return command({"export", "--list-formats"}); }

json Session::metadata(bool makernotes, bool edits)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    return command({"get-metadata",
                    makernotes ? "--makernotes" : "--no-makernotes",
                    edits ? "--edits" : "--no-edits"});
}

json Session::spotWB(int x, int y, int w, int h)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    return command({"get-spot-wb", std::to_string(x), std::to_string(y),
                    std::to_string(w), std::to_string(h)});
}

void Session::applyProfile(const std::string &id, bool append)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    const std::string p = profiles_.path(id);
    if (p.empty()) throw ApiError(404, "no such profile");
    if (Profiles::isBuiltin(id)) {
        command({"apply", p});  // ":neutral": a name of ART's, not a file
    } else {
        applyProfileFile(p, append, "look#" + std::to_string(++lookSeq_));
    }
    dirty_ = true;
    refreshInfo();
}

void Session::applyProfileFile(const std::string &path, bool append,
                               const std::string &mergeKey)
{
    auto apply = [&](const std::string &file) {
        std::vector<std::string> a = {"apply"};
        if (append) a.push_back("--append");
        if (!mergeKey.empty()) a.insert(a.end(), {"--merge", mergeKey});
        a.push_back(file);
        command(a);
    };
    // a LUT of MART's folder is `file://R/...` in a profile: for ART that is
    // relative to its own folder of LUTs
    const std::string original = slurp(path);
    const std::string text = luts_.resolveInProfile(original);
    const bool hasHalation = halation::present(text),
               hasRetouch = retouch::present(text),
               hasLC = localcontrast::present(text);
    auto writeTmp = [&](const std::string &name, const std::string &content) {
        const std::string file = tmpdir_ + "/" + name;
        std::ofstream f(file, std::ios::binary | std::ios::trunc);
        f << content;
        if (!f) throw ApiError(500, "cannot write " + file);
        return file;
    };
    if (!hasHalation && !hasRetouch && !hasLC) {
        apply(text == original ? path : writeTmp("profile.arp", text));
        return;
    }
    // The halation is a region of the smoothing tool and the retouching regions
    // are some of those of the color/tone correction tool, added after the
    // regions that the image has: the profile's Smoothing and ColorCorrection
    // groups are not applied as they are (they would replace those regions),
    // but through the same path as the controls.
    std::string rest = text;
    if (hasHalation) rest = halation::withoutSmoothing(rest);
    if (hasRetouch) rest = retouch::withoutColorCorrection(rest);
    if (hasLC) rest = localcontrast::withoutLocalContrast(rest);
    if (rest.find('[') != std::string::npos)
        apply(writeTmp("profile.arp", rest));
    auto applyText = [&](const std::string &t) {
        std::vector<std::string> a = {"apply"};
        if (!mergeKey.empty()) a.insert(a.end(), {"--merge", mergeKey});
        a.push_back(writeTmp("patch.arp", t));
        command(a);
    };
    if (hasHalation) {
        json st = halation::state(text);
        json change = {{"Enabled", st["Enabled"]},
                       {"Strength", st["Strength"]},
                       {"Tint", st["Tint"]}};
        applyText(halation::rewrite(command({"get-params"}).value("params", ""),
                                    change));
    }
    if (hasLC) {
        json st = localcontrast::state(text);
        json change = {{"Enabled", st["Enabled"]},
                       {"Fine", st["Fine"]},
                       {"Coarse", st["Coarse"]}};
        applyText(localcontrast::rewrite(
            command({"get-params"}).value("params", ""), change));
    }
    if (hasRetouch)
        applyText(retouch::replace(command({"get-params"}).value("params", ""),
                                   text));
}

json Session::profileSections()
{
    json r = json::array();
    for (auto &s : sections::list())
        r.push_back(
            {{"id", s.id}, {"label", s.label}, {"default", s.byDefault}});
    return r;
}

std::string Session::profileText(const std::vector<std::string> &ids, std::string &suggestedName)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    suggestedName = fileStem();
    try {
        return sections::build(command({"get-params"}).value("params", ""), ids,
                               [this](const std::string &v) {
                                   // a LUT of MART's folder is written without
                                   // the folder, with the host R, as ART does
                                   // for its own
                                   const std::string uri =
                                       luts_.toUri(luts_.fromUri(v));
                                   return uri.empty() ? v : uri;
                               });
    } catch (const std::invalid_argument &e) {
        throw ApiError(400, e.what());
    }
}

json Session::saveProfile(const std::string &name,
                          const std::vector<std::string> &ids, bool overwrite)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    std::string text;
    try {
        text = sections::build(command({"get-params"}).value("params", ""), ids,
                               [this](const std::string &v) {
                                   // a LUT of MART's folder is written without
                                   // the folder, with the host R, as ART does
                                   // for its own
                                   const std::string uri =
                                       luts_.toUri(luts_.fromUri(v));
                                   return uri.empty() ? v : uri;
                               });
        return profiles_.save(name, text, overwrite);
    } catch (const ProfileExists &e) {
        throw ApiError(409, e.what());
    } catch (const std::invalid_argument &e) {
        throw ApiError(400, e.what());
    }
}

}  // namespace mart
