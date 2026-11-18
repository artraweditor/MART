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

// Export requests: validation and the arguments of ART's `export` command.
#pragma once
#include "third_party/json.hpp"
#include <stdexcept>
#include <string>
#include <vector>

namespace mart {

struct ExportRequest {
    std::string format = "jpg";  // jpg, png or tif
    int quality = 92;            // jpg
    int bits = 0;  // png: 8 or 16; tif: 8, 16 or 32 (0: the format's default)
    bool halfFloat = false;   // tif, with 16 bits: floating point
    std::string compression;  // tif: "none" or "zip" (empty: the default)
    int size = 0;      // the longest edge in pixels at most (ART's fast export
                       // pipeline); 0: full size
    std::string stem;  // the file name without its extension
};

struct ExportRequestError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

// {"format","quality","bits","float","compression","size","name"}: unknown keys
// and options that do not apply to the format are refused. `defaultStem` is
// used when no (usable) name is given. Throws ExportRequestError.
ExportRequest parseExportRequest(const nlohmann::json &body,
                                 const std::string &defaultStem);

// a safe file name stem: letters, digits and a few punctuation marks; a known
// extension typed by the user is dropped
std::string sanitizeStem(const std::string &name);

std::string exportExtension(const std::string &format);  // "jpg", "png", "tif"
std::string exportMimeType(const std::string &format);

// the arguments of `export OUTFILE ...` for this request (without --overwrite:
// the name must be free)
std::vector<std::string> exportArgs(const ExportRequest &r,
                                    const std::string &outfile);

}  // namespace mart
