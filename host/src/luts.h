// The LUTs and CTL scripts that Film Simulation can use: those the host offers from folders, and uploaded ones.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "profiles.h"
#include "third_party/json.hpp"
#include <map>
#include <string>
#include <vector>

namespace mart {

class Luts {
public:
    Luts(std::vector<ProfileDir> dirs, const std::string &uploadDir);

    /** [{"id","name","source"}]; the ids are opaque to the client ("d<N>:<relative path>", "u<N>") */
    nlohmann::json list();
    /** store an uploaded file; returns its entry. Throws std::invalid_argument */
    nlohmann::json upload(const std::string &name, const std::string &bytes);
    /** the file of an id; empty if unknown. Never a path outside the folders and the uploads */
    std::string path(const std::string &id) const;
    /** removes the uploaded files */
    void clear();

    static constexpr size_t MAX_UPLOAD = 64u << 20;  // a Hald CLUT of level 16 is a 4096 x 4096 image

private:
    std::vector<ProfileDir> dirs_;
    std::string uploadDir_;
    std::map<std::string, std::string> uploads_;  // id -> file name
    int nextUpload_ = 1;
};

} // namespace mart
