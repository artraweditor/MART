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

// The LUTs and CTL scripts that Film Simulation can use: those in MART's own
// folder, where they are imported. A LUT of the folder is written in a profile
// as `file://R/<path in the folder>`, as ART does for its own folder (the host
// name R means "relative"), so that a profile can be applied in ART where the
// LUT is also installed.
#pragma once
#include "profiles.h"
#include "third_party/json.hpp"
#include <string>

namespace mart {

class Luts {
public:
    /** `dir` is the folder of the LUTs (made when the first one is imported) */
    explicit Luts(std::string dir);

    /** [{"id","name","source"}]: the ids are opaque to the client ("d0:<path in
     * the folder>"); the name is that path */
    nlohmann::json list();
    /** store a LUT in the folder under this file name (it must have the
     * extension of a format of ART's). Throws std::invalid_argument (bad name
     * or empty file) and ProfileExists */
    nlohmann::json import(const std::string &fileName,
                          const std::string &bytes);
    /** rename a LUT (the extension stays: `newName` is the name without it, or
     * with it). Throws like `import`, and std::out_of_range if there is no such
     * LUT */
    nlohmann::json rename(const std::string &id, const std::string &newName);
    /** delete a LUT. Throws std::out_of_range if there is no such LUT */
    void remove(const std::string &id);
    /** the file of an id; empty if unknown. Never a path outside the folder */
    std::string path(const std::string &id) const;

    const std::string &dir() const { return dir_; }
    /** `file://R/<path in the folder>` for a file of the folder (what a profile
     * that is saved holds), else "" */
    std::string toUri(const std::string &path) const;
    /** the file that a `ClutFilename` of a profile means: an absolute path, a
     * `file://` URI (no host, or R: relative to the folder, or H: the home
     * folder), or a path relative to the folder. "" if it cannot be told */
    std::string fromUri(const std::string &uriOrPath) const;
    /** the text of a profile with a LUT of the folder (`file://R/...`, or a
     * relative path) made an absolute path, for ART: its own R means its own
     * LUT folder */
    std::string resolveInProfile(const std::string &text) const;

    static constexpr size_t MAX_IMPORT =
        64u << 20;  // a Hald CLUT of level 16 is a 4096 x 4096 image

private:
    std::string dir_;
};

}  // namespace mart
