// SPDX-License-Identifier: GPL-3.0-or-later
#include "session.h"
#include "arp.h"
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
    std::string d = tmpl;
    if (mkdir((d + "/uploads").c_str(), 0700) != 0) throw std::runtime_error("cannot create a temporary directory");
    return d;
}
} // namespace

Session::Session(const EngineOptions &o, std::vector<std::string> roots, std::vector<ProfileDir> profileDirs):
    opts_(o), roots_(std::move(roots)), tmpdir_(makeTmpdir()), profiles_(std::move(profileDirs), tmpdir_ + "/uploads")
{
    engine_ = Engine::create(o);
}

Session::~Session()
{
    engine_.reset();
    unlink((tmpdir_ + "/preview.jpg").c_str());
    unlink((tmpdir_ + "/patch.arp").c_str());
    if (DIR *d = opendir((tmpdir_ + "/uploads").c_str())) {
        while (dirent *e = readdir(d))
            if (e->d_name[0] != '.') unlink((tmpdir_ + "/uploads/" + e->d_name).c_str());
        closedir(d);
    }
    rmdir((tmpdir_ + "/uploads").c_str());
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

json Session::open(const std::string &path, bool discard)
{
    std::string p = confine(path);
    if (dirty_ && !discard) throw ApiError(409, "the image has unsaved edits");
    command({"open", p});
    file_ = p;
    dirty_ = false;
    info_ = command({"get-info"});
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
    return f;
}

json Session::params()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json r = command({"get-params"});
    std::string ini = r.value("params", "");
    return {{"params", arp::parse(ini)}, {"ini", ini}};
}

void Session::applyPatch(const json &patch, const std::string &mergeKey)
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    std::string text;
    try {
        text = arp::serialize(patch);
    } catch (const arp::PatchError &e) {
        throw ApiError(400, e.what());
    }
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
    if (patch.contains("Coarse Transformation")) refreshInfo();
}

json Session::undo()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
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
    return {{"selected", sel}, {"count", count}, {"can_undo", sel > 0}, {"can_redo", sel >= 0 && sel + 1 < count}};
}

json Session::save()
{
    if (file_.empty()) throw ApiError(409, "no image is open");
    json r = command({"save"});
    dirty_ = false;
    return r;
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
    std::vector<std::string> a = {"apply"};
    if (append) a.push_back("--append");
    a.push_back(p);
    command(a);
    dirty_ = true;
    refreshInfo();
}

} // namespace mart
