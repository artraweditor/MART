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

// Full-size export as a background job, and the files it makes.
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
    // `dir`: where files are written and kept; empty: a temporary directory,
    // removed with the exporter (the files are then only reachable by
    // downloading them). `onBusy` is told when an export starts and ends.
    Exporter(Worker &w, Session &s, const std::string &dir,
             std::function<void(bool)> onBusy);
    ~Exporter();

    // validate and queue an export of the current parameters; returns {"job"}.
    // Throws ApiError
    json start(const json &body);
    json status(const std::string &id) const;
    // the finished file of a job
    bool file(const std::string &id, std::string &path, std::string &name,
              std::string &mime) const;
    bool busy() const;
    bool keepsFiles() const { return persistent_; }

private:
    struct Job {
        std::string state = "queued";  // queued, running, done, error
        std::string name, path, format, error, mime;
        bool keep = false;  // written to a folder chosen by the user: never deleted
        int width = 0, height = 0;
        long long bytes = 0;
        long long startedMs = 0, endedMs = 0;
    };
    void run(const std::string &id, const ExportRequest &, const std::string &dir);
    std::string uniquePath(const std::string &stem,
                           const std::string &ext, const std::string &dir) const;  // worker thread

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

}  // namespace mart
