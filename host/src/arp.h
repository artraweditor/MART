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

// Edit patches <-> .arp text.
#pragma once
#include "third_party/json.hpp"
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

namespace mart {
namespace arp {

using json = nlohmann::json;

struct PatchError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

// Validate a patch {"Group": {"Key": value}} against what MART may write and
// serialise it as a partial .arp (no [Version], no [General]). Unknown groups
// and keys, wrong types and out-of-range values throw PatchError. Only the
// tools that MART has controls for are allowed (never a key holding a file
// name, so that a client on the network cannot make ART read arbitrary files:
// the one file key, the LUT of Film Simulation, holds an id that `lutPath`
// turns into a path of a file the host offers, or throws PatchError).
using Resolver = std::function<std::string(const std::string &id)>;
std::string serialize(const json &patch, const Resolver &lutPath = nullptr);

// .arp text (GLib key file) -> {"Group": {"Key": value}}; values that look
// like booleans or numbers become JSON ones, everything else (lists, enums)
// stays a string.
json parse(const std::string &ini);

// the allowed groups and their keys, for tests
std::vector<std::pair<std::string, std::vector<std::string>>> allowedKeys();

}  // namespace arp
}  // namespace mart
