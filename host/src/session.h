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

#pragma once
#include "libart_dyn.h"
#include "luts.h"
#include "profiles.h"
#include "third_party/json.hpp"
#include <string>
#include <vector>

namespace mart {

using json = nlohmann::json;

struct ApiError : std::runtime_error {
    int status;
    ApiError(int s, const std::string &m) : std::runtime_error(m), status(s) {}
};

struct PreviewRequest {
    double scale = 0;  // 0: derive from out_w
    int out_w = 0;     // requested output width, if scale == 0
    int x = 0, y = 0, w = 0,
        h = 0;  // region in full-image pixels (w == 0: all)
};

struct PreviewFrame {
    std::string jpeg;
    int width = 0, height = 0;
    int x = 0, y = 0, w = 0,
        h = 0;  // the region of the image that was rendered
};

// The one open image and the engine. All methods must run on the worker thread.
class Session {
public:
    Session(const EngineOptions &o, std::vector<std::string> roots,
            std::vector<ProfileDir> profileDirs, std::string lutDir);
    ~Session();

    json status() const;
    /// allow opening images under `dir` (any thread)
    void addRoot(const std::string &dir);
    /// the images in a folder under a root: {dir, parent, dirs: [{name, path}], images: [{name, path, size,
    /// mtime, edited}]}. `parent` is the folder above if it is under a root too, else "" (the list of the roots);
    /// an empty `dir` is that list itself: `dirs` are the roots, with no images.
    json listImages(const std::string &dir) const;
    json open(
        const std::string &path,
        bool discard = false);  // returns get-info; 409 if dirty and !discard
    json info();
    json version();
    PreviewFrame preview(const PreviewRequest &r);
    /// a JPEG (sRGB) thumbnail of an image file under a root, whose longest edge is at most
    /// `size` (libART's `thumbnail --no-profile`: the embedded preview of a raw, ignoring
    /// the sidecar). Needs no open image and does not touch it.
    std::string thumbnail(const std::string &path, int size);

    json params();  // {params:{Group:{Key:v}}, ini}
    void applyPatch(const json &patch, const std::string &mergeKey);
    /** make the regions of Local Contrast that give details to the retouching
     * regions match them (localcontrast::syncDetails); `change` has the
     * details to set, by region id */
    void syncDetails(const json &change, const std::string &mergeKey);
    json undo();  // result of `undo`
    json redo();
    json history();  // {selected, count, can_undo, can_redo}
    json save();     // {file}
    json metadata(bool makernotes, bool edits);  // flat object of tags
    json spotWB(int x, int y, int w, int h);
    Profiles &profiles() { return profiles_; }
    Luts &luts() { return luts_; }
    json lutParams(const std::string &id =
                       "");  // {params, presets[, error]} of the LUT of Film
                             // Simulation (ART translates the labels)
    std::string fileStem() const;  // the image's file name without directory
                                   // and extension ("" if none)
    json exportImage(
        const std::vector<std::string>
            &exportArgs);  // runs `export ...` (blocks: seconds to minutes)
    json exportFormats();
    void applyProfile(const std::string &id, bool append);
    json profileSections();  // [{id, label, default}]: the checkboxes of the
                             // Save dialog
    // the settings of the given sections as the text of a profile (an .arp) and the name that suits it
    std::string profileText(const std::vector<std::string> &sections, std::string &suggestedName);
    json saveProfile(const std::string &name,
                     const std::vector<std::string> &sections, bool overwrite);
    // a folder that exports may be written to: under a root, and writable (its realpath); throws ApiError
    std::string exportFolder(const std::string &dir) const;
    bool dirty() const { return dirty_; }
    bool isOpen() const { return !file_.empty(); }
    int fullWidth() const { return info_.value("full_width", 0); }
    int fullHeight() const { return info_.value("full_height", 0); }

private:
    json command(
        const std::vector<std::string> &argv);  // "result" of a JSON reply
    std::string confine(
        const std::string &path) const;  // realpath under a root
    bool underRoot(const std::string &realPath) const;  // a realpath that is a root or in one
    void refreshInfo();
    void applyOpeningDefaults();
    // apply the profile file (a MART profile can hold the halation, which is
    // not a plain group); with a merge key it is one history entry
    void applyProfileFile(
        const std::string &path, bool append,
        const std::string &mergeKey);  // the size changes with coarse rotation

    EngineOptions opts_;
    std::unique_ptr<Engine> engine_;
    std::vector<std::string> roots_;
    mutable std::mutex rootsMutex_;  // roots_ can grow while the worker reads it
    std::string tmpdir_;
    std::string file_;
    json info_;
    json defaults_;  // the parameters of the neutral profile (null until seen)
    json version_;
    bool dirty_ = false;
    int lookSeq_ =
        0;  // keys that merge the history entries of one applied profile
    int base_ = 0;  // the first history entry the user can go back to (1 after
                    // a default that MART applied on opening)
    Profiles profiles_;
    Luts luts_;
};

}  // namespace mart
