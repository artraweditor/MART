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

#include "exporter.h"
#include "tempdir.h"
#include <chrono>
#include <cstdlib>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

namespace mart {

namespace {

long long nowMs()
{
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch())
        .count();
}

bool exists(const std::string &p)
{
    struct stat st;
    return stat(p.c_str(), &st) == 0;
}

constexpr size_t KEEP_JOBS = 8;

}  // namespace

Exporter::Exporter(Worker &w, Session &s, const std::string &dir,
                   std::function<void(bool)> onBusy) :
    worker_(w), session_(s), dir_(dir), persistent_(!dir.empty()),
    onBusy_(std::move(onBusy))
{
    if (persistent_) {
        struct stat st;
        if (stat(dir_.c_str(), &st) != 0 || !S_ISDIR(st.st_mode))
            throw std::runtime_error("no such export directory: " + dir_);
        if (access(dir_.c_str(), W_OK) != 0)
            throw std::runtime_error("cannot write to the export directory: " +
                                     dir_);
    } else {
        dir_ = makeTempDir("mart-exports-");
    }
}

Exporter::~Exporter()
{
    if (persistent_) return;
    if (DIR *d = opendir(dir_.c_str())) {
        while (dirent *e = readdir(d))
            if (e->d_name[0] != '.') unlink((dir_ + "/" + e->d_name).c_str());
        closedir(d);
    }
    rmdir(dir_.c_str());
}

bool Exporter::busy() const
{
    std::lock_guard<std::mutex> g(m_);
    return active_;
}

std::string Exporter::uniquePath(const std::string &stem,
                                 const std::string &ext,
                                 const std::string &dir) const
{
    const std::string &d = dir.empty() ? dir_ : dir;
    std::string p = d + "/" + stem + "." + ext;
    for (int i = 1; exists(p) && i < 10000; ++i)
        p = d + "/" + stem + "-" + std::to_string(i) + "." + ext;
    return p;
}

json Exporter::start(const json &body)
{
    {
        std::lock_guard<std::mutex> g(m_);
        if (active_) throw ApiError(409, "an export is already running");
        active_ = true;  // reserved: nothing else can start until this one ends
    }
    auto release = [this] {
        std::lock_guard<std::mutex> g(m_);
        active_ = false;
    };
    ExportRequest req;
    std::string folder;  // chosen by the user: the file is written (and kept) there
    try {
        // the default name is that of the image, which only the worker thread
        // may ask
        std::string stem =
            worker_.submit([this] { return session_.fileStem(); }).get();
        if (stem.empty()) throw ApiError(409, "no image is open");
        json b = body;
        if (b.is_object() && b.contains("dir")) {
            if (!b["dir"].is_string()) throw ApiError(400, "dir must be a string");
            const std::string d = b["dir"];
            b.erase("dir");
            if (!d.empty()) folder = worker_.submit([this, d] { return session_.exportFolder(d); }).get();
        }
        req = parseExportRequest(b, stem);
    } catch (const ExportRequestError &e) {
        release();
        throw ApiError(400, e.what());
    } catch (...) {
        release();
        throw;
    }
    std::string id;
    {
        std::lock_guard<std::mutex> g(m_);
        id = "e" + std::to_string(next_++);
        jobs_[id] = Job{};
        jobs_[id].format = req.format;
        jobs_[id].keep = !folder.empty();
        jobs_[id].mime = exportMimeType(req.format);
        jobs_[id].startedMs = nowMs();
        order_.push_back(id);
        while (order_.size() >
               KEEP_JOBS) {  // forget the oldest (and delete its file, unless
                             // the user keeps them)
            auto &old = jobs_[order_.front()];
            if (!persistent_ && !old.keep && !old.path.empty()) unlink(old.path.c_str());
            jobs_.erase(order_.front());
            order_.erase(order_.begin());
        }
    }
    if (onBusy_) onBusy_(true);
    worker_.submit([this, id, req, folder] { run(id, req, folder); });
    return {{"job", id}};
}

void Exporter::run(const std::string &id, const ExportRequest &req, const std::string &dir)
{
    std::string path = uniquePath(req.stem, exportExtension(req.format), dir);
    {
        std::lock_guard<std::mutex> g(m_);
        auto it = jobs_.find(id);
        if (it != jobs_.end()) {
            it->second.state = "running";
            it->second.path = path;
            it->second.name = path.substr(path.rfind('/') + 1);
        }
    }
    std::string error;
    json result;
    try {
        result = session_.exportImage(exportArgs(req, path));
    } catch (const std::exception &e) {
        error = e.what();
    }
    {
        std::lock_guard<std::mutex> g(m_);
        auto it = jobs_.find(id);
        if (it != jobs_.end()) {
            Job &j = it->second;
            j.endedMs = nowMs();
            if (error.empty()) {
                struct stat st;
                j.state = "done";
                j.width = result.value("width", 0);
                j.height = result.value("height", 0);
                j.bytes = stat(path.c_str(), &st) == 0
                              ? static_cast<long long>(st.st_size)
                              : 0;
            } else {
                j.state = "error";
                j.error = error;
                unlink(path.c_str());
                j.path.clear();
            }
        }
        active_ = false;
    }
    if (onBusy_) onBusy_(false);
}

json Exporter::status(const std::string &id) const
{
    std::lock_guard<std::mutex> g(m_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) throw ApiError(404, "no such export");
    const Job &j = it->second;
    json r = {{"state", j.state},
              {"format", j.format},
              {"elapsed_ms", (j.endedMs ? j.endedMs : nowMs()) - j.startedMs}};
    if (j.state == "done") {
        r["name"] = j.name;
        r["width"] = j.width;
        r["height"] = j.height;
        r["bytes"] = j.bytes;
        if (persistent_ || j.keep)
            r["path"] = j.path;  // otherwise the file is only for downloading
        if (j.keep) r["chosen"] = true;  // in the folder that the user chose
    } else if (j.state == "error") {
        r["error"] = j.error;
    }
    return r;
}

bool Exporter::file(const std::string &id, std::string &path, std::string &name,
                    std::string &mime) const
{
    std::lock_guard<std::mutex> g(m_);
    auto it = jobs_.find(id);
    if (it == jobs_.end() || it->second.state != "done") return false;
    path = it->second.path;
    name = it->second.name;
    mime = it->second.mime;
    return true;
}

}  // namespace mart
