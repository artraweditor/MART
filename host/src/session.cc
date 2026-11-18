// SPDX-License-Identifier: GPL-3.0-or-later
#include "session.h"
#include "arp.h"
#include "halation.h"
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
} // namespace

namespace {
std::string makeTmpdir()
{
    char tmpl[] = "/tmp/mart-XXXXXX";
    if (!mkdtemp(tmpl)) throw std::runtime_error("cannot create a temporary directory");
    return tmpl;
}

} // namespace

Session::Session(const EngineOptions &o, std::vector<std::string> roots, std::vector<ProfileDir> profileDirs, std::string lutDir):
    opts_(o), roots_(std::move(roots)), tmpdir_(makeTmpdir()), profiles_(std::move(profileDirs)), luts_(std::move(lutDir))
{
    engine_ = Engine::create(o);
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
        std::string msg = doc.is_object() && doc.contains("error") ? doc["error"].get<std::string>() : r.err;
        throw ApiError(422, msg.empty() ? "the command failed" : msg);
    }
    if (doc.is_discarded()) throw ApiError(502, "unexpected reply from ART: " + r.out.substr(0, 200));
    return doc.contains("result") ? doc["result"] : json::object();
}

std::string Session::confine(const std::string &path) const
{
    char *rp = realpath(path.c_str(), nullptr);
    if (!rp) throw ApiError(404, "no such file: " + path);
    std::string p = rp;
    free(rp);
    for (auto root : roots_) {
        char *rr = realpath(root.c_str(), nullptr);
        if (!rr) continue;
        std::string r = rr;
        free(rr);
        if (p == r || p.compare(0, r.size() + 1, r + "/") == 0) return p;
    }
    throw ApiError(403, "the file is not under an allowed root");
}

json Session::status() const
{
    json s;
    s["version"] = "0.1.0";
    s["art_version"] = Engine::version();
    s["backend"] = opts_.inprocess ? "inprocess" : "remote";
    s["open"] = file_.empty() ? json(nullptr) : json{{"file", file_}};
    s["dirty"] = dirty_;
    s["busy"] = nullptr;
    return s;
}

// What is applied when an image is opened, as the start of its history (not as edits: they cannot be undone and the
// image is not "unsaved"):
// - a picture that has no sidecar starts from the neutral profile, not from what ART would load for it (its default
//   or dynamic profile): MART has its own profiles;
// - a DNG made by a phone can carry a flat field (gain maps) that corrects its vignetting: using it is on by default,
//   unless the sidecar says otherwise. Other raws have none to use, so nothing is written for them;
// - the default profile, if one was chosen, for a picture that has no sidecar.
// In this order: the neutral profile resets everything, and the default profile can say otherwise about the flat field.
void Session::applyOpeningDefaults()
{
    base_ = 0;
    struct stat st;
    const bool hasSidecar = stat((file_ + ".arp").c_str(), &st) == 0;
    if (!hasSidecar) command({"apply", ":neutral"});
    std::string lower = file_;
    for (auto &c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (info_.value("is_raw", false) && lower.size() >= 4 && lower.compare(lower.size() - 4, 4, ".dng") == 0) {
        std::ifstream side(file_ + ".arp", std::ios::binary);
        std::stringstream text;
        text << side.rdbuf();
        if (text.str().find("FlatFieldUseEmbedded") == std::string::npos) {  // else: a choice of the user
            const std::string path = tmpdir_ + "/defaults.arp";
            {
                std::ofstream f(path, std::ios::binary | std::ios::trunc);
                f << "[RAW]\nFlatFieldEnabled=true\nFlatFieldUseEmbedded=true\n";
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
                // a profile that ART does not accept must not keep the image from opening
            }
        }
    }
    // the first entry of the history that the user can go back to: where the defaults left it
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

PreviewFrame Session::preview(const PreviewRequest &rq)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    const int fw = info_.value("full_width", 0), fh = info_.value("full_height", 0);
    int x = rq.x, y = rq.y, w = rq.w, h = rq.h;
    // a view of the old geometry (before a rotation, say) may not fit the image any more: show it all
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > fw || y + h > fh) x = y = 0, w = fw, h = fh;
    const bool whole = (x == 0 && y == 0 && w == fw && h == fh);
    double scale = rq.scale;
    if (scale <= 0) scale = rq.out_w > 0 ? double(rq.out_w) / w : 1.0;
    if (!(scale > 0) || scale > 4) throw ApiError(400, "invalid scale");
    const std::string file = tmpdir_ + "/preview.jpg";
    std::vector<std::string> a = {"preview", file, "--scale", std::to_string(scale)};
    if (!whole)
        a.insert(a.end(), {"--crop", std::to_string(x) + "," + std::to_string(y) + "," + std::to_string(w) + "," +
                                         std::to_string(h)});
    json r = command(a);
    PreviewFrame f;
    f.width = r.value("width", 0);
    f.height = r.value("height", 0);
    f.x = x, f.y = y, f.w = w, f.h = h;
    f.jpeg = slurp(file);
    if (f.jpeg.empty()) throw ApiError(502, "ART wrote no preview");
    // `preview` always renders in sRGB (whatever the output, working or monitor profile) but embeds no profile: say
    // so, so that a browser or a screen with another profile (a wide gamut one) converts the colours instead of
    // showing them raw. This needs an ART in which the preview is always sRGB (see the README).
    f.jpeg = tagAsSRGB(f.jpeg);
    return f;
}

json Session::params()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json r = command({"get-params"});
    std::string ini = r.value("params", "");
    json doc = arp::parse(ini);
    doc["Halation"] = halation::state(ini);  // not a group of the profile: MART's own view of one of the Smoothing regions
    return {{"params", doc}, {"ini", ini}};
}

json Session::lutParams(const std::string &id)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    std::string path;
    if (!id.empty()) {
        path = luts_.path(id);  // a LUT that was just chosen: the profile may not have it yet
        if (path.empty()) throw ApiError(404, "no such LUT");
    } else {
        json p = arp::parse(command({"get-params"}).value("params", ""));
        path = p.contains("Film Simulation") ? p["Film Simulation"].value("ClutFilename", "") : "";
    }
    json r = {{"params", json::array()}, {"presets", json::array()}};
    if (path.empty()) return r;
    path = luts_.fromUri(path);   // what the profile says (a URI, with the R host for the LUTs of MART's folder)
    try {
        r = command({"get-clut-params", path});
    } catch (const ApiError &e) {
        r["error"] = e.what();  // the file may not be on this machine (a relative or foreign path in the sidecar)
    }
    return r;
}

void Session::applyPatch(const json &patchIn, const std::string &mergeKey)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json patch = patchIn;
    json halationChange;
    if (patch.is_object() && patch.contains("Halation")) {
        halationChange = patch["Halation"];
        patch.erase("Halation");
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
    if (halationChange.is_null() || !patch.empty()) {
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
            text = halation::rewrite(command({"get-params"}).value("params", ""), halationChange);
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
    if (h.value("selected", 0) <= base_) return {{"selected", h.value("selected", 0)}};  // at the start: nothing to undo
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
    return {{"selected", sel}, {"count", count}, {"can_undo", sel > base_}, {"can_redo", sel >= 0 && sel + 1 < count}};
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
    // Exports are always sRGB, like the preview (and what a phone expects), whatever the output profile of the
    // image is. `--profile` overrides the settings for this export only: the image, its history and its sidecar
    // are not touched. The intent and black point compensation are those of the preview.
    const std::string path = tmpdir_ + "/export.arp";
    {
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        f << "[Color Management]\nOutputBPC=true\nOutputProfile=RTv2_sRGB\nOutputProfileIntent=Relative\n";
        if (!f) throw ApiError(500, "cannot write " + path);
    }
    std::vector<std::string> a = args;
    a.insert(a.end(), {"--profile", path});
    return command(a);
}

json Session::exportFormats()
{
    return command({"export", "--list-formats"});
}

json Session::metadata(bool makernotes, bool edits)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    return command({"get-metadata", makernotes ? "--makernotes" : "--no-makernotes", edits ? "--edits" : "--no-edits"});
}

json Session::spotWB(int x, int y, int w, int h)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    return command({"get-spot-wb", std::to_string(x), std::to_string(y), std::to_string(w), std::to_string(h)});
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

void Session::applyProfileFile(const std::string &path, bool append, const std::string &mergeKey)
{
    auto apply = [&](const std::string &file) {
        std::vector<std::string> a = {"apply"};
        if (append) a.push_back("--append");
        if (!mergeKey.empty()) a.insert(a.end(), {"--merge", mergeKey});
        a.push_back(file);
        command(a);
    };
    // a LUT of MART's folder is `file://R/...` in a profile: for ART that is relative to its own folder of LUTs
    const std::string original = slurp(path);
    const std::string text = luts_.resolveInProfile(original);
    if (!halation::present(text)) {
        if (text == original) {
            apply(path);
        } else {
            const std::string file = tmpdir_ + "/profile.arp";
            {
                std::ofstream f(file, std::ios::binary | std::ios::trunc);
                f << text;
                if (!f) throw ApiError(500, "cannot write " + file);
            }
            apply(file);
        }
        return;
    }
    // The halation is a region of the smoothing tool, added after the regions that the image has: the profile's
    // Smoothing group is not applied as it is (it would replace them), but through the same path as the slider.
    const std::string rest = halation::withoutSmoothing(text);
    if (rest.find('[') != std::string::npos) {
        const std::string file = tmpdir_ + "/profile.arp";
        {
            std::ofstream f(file, std::ios::binary | std::ios::trunc);
            f << rest;
            if (!f) throw ApiError(500, "cannot write " + file);
        }
        apply(file);
    }
    json st = halation::state(text);
    json change = {{"Enabled", st["Enabled"]}, {"Strength", st["Strength"]}, {"Tint", st["Tint"]}};
    const std::string patch = tmpdir_ + "/patch.arp";
    {
        std::ofstream f(patch, std::ios::binary | std::ios::trunc);
        f << halation::rewrite(command({"get-params"}).value("params", ""), change);
        if (!f) throw ApiError(500, "cannot write " + patch);
    }
    std::vector<std::string> a = {"apply"};
    if (!mergeKey.empty()) a.insert(a.end(), {"--merge", mergeKey});
    a.push_back(patch);
    command(a);
}

json Session::profileSections()
{
    json r = json::array();
    for (auto &s : sections::list()) r.push_back({{"id", s.id}, {"label", s.label}, {"default", s.byDefault}});
    return r;
}

json Session::saveProfile(const std::string &name, const std::vector<std::string> &ids, bool overwrite)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    std::string text;
    try {
        text = sections::build(command({"get-params"}).value("params", ""), ids, [this](const std::string &v) {
            // a LUT of MART's folder is written without the folder, with the host R, as ART does for its own
            const std::string uri = luts_.toUri(luts_.fromUri(v));
            return uri.empty() ? v : uri;
        });
        return profiles_.save(name, text, overwrite);
    } catch (const ProfileExists &e) {
        throw ApiError(409, e.what());
    } catch (const std::invalid_argument &e) {
        throw ApiError(400, e.what());
    }
}

} // namespace mart
