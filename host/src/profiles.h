// The saved profiles (.arp files) that can be applied: ART's own, the user's, and uploaded ones.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "third_party/json.hpp"
#include <map>
#include <string>
#include <vector>

namespace mart {

struct ProfileDir {
    std::string tag;   // "bundled", "user" ... shown in the list
    std::string path;
};

class Profiles {
public:
    Profiles(std::vector<ProfileDir> dirs, const std::string &uploadDir);

    // [{"id","name","source"}]: ids are opaque to the client ("d<N>:<relative path>", "u<N>")
    nlohmann::json list();
    // store an uploaded profile (text of an .arp); returns its entry. Throws std::invalid_argument
    nlohmann::json upload(const std::string &name, const std::string &text);
    // the file of an id; empty if unknown. Never a path outside the directories
    std::string path(const std::string &id) const;

private:
    std::vector<ProfileDir> dirs_;
    std::string uploadDir_;
    std::map<std::string, std::string> uploads_;  // id -> display name
    int nextUpload_ = 1;
};

} // namespace mart
