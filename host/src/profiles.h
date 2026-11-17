// The profiles (.arp files) that can be applied: MART's own, kept in one folder of the user's, and uploaded ones.
// One of them can be the default for images that have no sidecar.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "third_party/json.hpp"
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace mart {

struct ProfileDir {
    std::string tag;   // "mine" ... shown in the list
    std::string path;
};

/** a profile of that name is already there */
struct ProfileExists: std::runtime_error {
    using std::runtime_error::runtime_error;
};

class Profiles {
public:
    /** `dirs[0]` is where profiles are saved (it is made when needed) and where the default is kept */
    Profiles(std::vector<ProfileDir> dirs, const std::string &uploadDir);

    // [{"id","name","source","default"}]: ids are opaque to the client ("d<N>:<relative path>", "u<N>")
    nlohmann::json list();
    // store an uploaded profile (text of an .arp); returns its entry. Throws std::invalid_argument
    nlohmann::json upload(const std::string &name, const std::string &text);
    // save a profile in the folder: `<name>.arp` (the name is made safe). Throws std::invalid_argument (no usable name,
    // nothing to save, no folder) and ProfileExists unless `overwrite`
    nlohmann::json save(const std::string &name, const std::string &text, bool overwrite);
    // rename a profile of the folder (the name is made safe; ProfileExists if another profile has it); returns its
    // entry. The default stays the default. Throws std::invalid_argument for a bad name or an id that is not a profile
    // of the folder, std::out_of_range if there is no such profile
    nlohmann::json rename(const std::string &id, const std::string &newName);
    // delete a profile of the folder (it is no longer the default, if it was). Same exceptions as `rename`
    void remove(const std::string &id);
    // the default profile for images without a sidecar: the id of a profile of the folder, "" for none (throws
    // std::invalid_argument for anything else); and its file ("" if none, or if the file is gone)
    void setDefault(const std::string &id);
    std::string defaultPath() const;
    // the file of an id; empty if unknown. Never a path outside the directories
    /** ":neutral": the profile that ART builds in (every tool at its default) */
    static bool isBuiltin(const std::string &id) { return id == ":neutral"; }
    std::string path(const std::string &id) const;

    /** a file name stem for a profile: letters, digits and a few punctuation marks; "" if nothing is usable */
    static std::string sanitizeName(const std::string &name);

private:
    std::string defaultRel() const;  // the name kept in the folder, "" if none

    std::vector<ProfileDir> dirs_;
    std::string uploadDir_;
    std::map<std::string, std::string> uploads_;  // id -> display name
    int nextUpload_ = 1;
};

} // namespace mart
