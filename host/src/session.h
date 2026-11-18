// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "libart_dyn.h"
#include "luts.h"
#include "profiles.h"
#include "third_party/json.hpp"
#include <string>
#include <vector>

namespace mart {

using json = nlohmann::json;

struct ApiError: std::runtime_error {
    int status;
    ApiError(int s, const std::string &m): std::runtime_error(m), status(s) {}
};

struct PreviewRequest {
    double scale = 0;            // 0: derive from out_w
    int out_w = 0;               // requested output width, if scale == 0
    int x = 0, y = 0, w = 0, h = 0;  // region in full-image pixels (w == 0: all)
};

struct PreviewFrame {
    std::string jpeg;
    int width = 0, height = 0;
    int x = 0, y = 0, w = 0, h = 0;  // the region of the image that was rendered
};

// The one open image and the engine. All methods must run on the worker thread.
class Session {
public:
    Session(const EngineOptions &o, std::vector<std::string> roots, std::vector<ProfileDir> profileDirs, std::string lutDir);
    ~Session();

    json status() const;
    json open(const std::string &path, bool discard = false);   // returns get-info; 409 if dirty and !discard
    json info();
    PreviewFrame preview(const PreviewRequest &r);

    json params();                                    // {params:{Group:{Key:v}}, ini}
    void applyPatch(const json &patch, const std::string &mergeKey);
    json undo();                                      // result of `undo`
    json redo();
    json history();                                   // {selected, count, can_undo, can_redo}
    json save();                                      // {file}
    json metadata(bool makernotes, bool edits);       // flat object of tags
    json spotWB(int x, int y, int w, int h);
    Profiles &profiles() { return profiles_; }
    Luts &luts() { return luts_; }
    json lutParams(const std::string &id = "");                                 // {params, presets[, error]} of the LUT of Film Simulation (ART translates the labels)
    std::string fileStem() const;                     // the image's file name without directory and extension ("" if none)
    json exportImage(const std::vector<std::string> &exportArgs);   // runs `export ...` (blocks: seconds to minutes)
    json exportFormats();
    void applyProfile(const std::string &id, bool append);
    json profileSections();                           // [{id, label, default}]: the checkboxes of the Save dialog
    json saveProfile(const std::string &name, const std::vector<std::string> &sections, bool overwrite);
    bool dirty() const { return dirty_; }
    bool isOpen() const { return !file_.empty(); }
    int fullWidth() const { return info_.value("full_width", 0); }
    int fullHeight() const { return info_.value("full_height", 0); }

private:
    json command(const std::vector<std::string> &argv);  // "result" of a JSON reply
    std::string confine(const std::string &path) const;  // realpath under a root
    void refreshInfo();
    void applyOpeningDefaults();
    // apply the profile file (a MART profile can hold the halation, which is not a plain group); with a merge key it is
    // one history entry
    void applyProfileFile(const std::string &path, bool append, const std::string &mergeKey);                                  // the size changes with coarse rotation

    EngineOptions opts_;
    std::unique_ptr<Engine> engine_;
    std::vector<std::string> roots_;
    std::string tmpdir_;
    std::string file_;
    json info_;
    bool dirty_ = false;
    int lookSeq_ = 0;  // keys that merge the history entries of one applied profile
    int base_ = 0;  // the first history entry the user can go back to (1 after a default that MART applied on opening)
    Profiles profiles_;
    Luts luts_;
};

} // namespace mart
