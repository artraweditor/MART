// Edit patches <-> .arp text. SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "third_party/json.hpp"
#include <stdexcept>
#include <string>
#include <vector>

namespace mart { namespace arp {

using json = nlohmann::json;

struct PatchError: std::runtime_error {
    using std::runtime_error::runtime_error;
};

// Validate a patch {"Group": {"Key": value}} against what MART may write and
// serialise it as a partial .arp (no [Version], no [General]). Unknown groups
// and keys, wrong types and out-of-range values throw PatchError. Only the
// tools that MART has controls for are allowed (never a key holding a file
// name, so that a client on the network cannot make ART read arbitrary files).
std::string serialize(const json &patch);

// .arp text (GLib key file) -> {"Group": {"Key": value}}; values that look
// like booleans or numbers become JSON ones, everything else (lists, enums)
// stays a string.
json parse(const std::string &ini);

// the allowed groups and their keys, for tests
std::vector<std::pair<std::string, std::vector<std::string>>> allowedKeys();

}} // namespace mart::arp
