// Full-size export as a background job, and the files it makes.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "exportreq.h"
#include "session.h"
#include "worker.h"
#include <functional>
#include <map>
#include <mutex>
#include <string>

namespace mart {

class Exporter {
public:
    // `dir`: where files are written and kept; empty: a temporary directory, removed with the exporter
    // (the files are then only reachable by downloading them). `onBusy` is told when an export starts and ends.
    Exporter(Worker &w, Session &s, const std::string &dir, std::function<void(bool)> onBusy);
    ~Exporter();

    // validate and queue an export of the current parameters; returns {"job"}. Throws ApiError
    json start(const json &body);
    json status(const std::string &id) const;
    // the finished file of a job
    bool file(const std::string &id, std::string &path, std::string &name, std::string &mime) const;
    bool busy() const;
    bool keepsFiles() const { return persistent_; }

private:
    struct Job {
        std::string state = "queued";  // queued, running, done, error
        std::string name, path, format, error, mime;
        int width = 0, height = 0;
        long long bytes = 0;
        long long startedMs = 0, endedMs = 0;
    };
    void run(const std::string &id, const ExportRequest &);
    std::string uniquePath(const std::string &stem, const std::string &ext) const;  // worker thread

    Worker &worker_;
    Session &session_;
    std::string dir_;
    bool persistent_;
    std::function<void(bool)> onBusy_;
    mutable std::mutex m_;
    std::map<std::string, Job> jobs_;
    std::vector<std::string> order_;
    int next_ = 1;
    bool active_ = false;
};

} // namespace mart
