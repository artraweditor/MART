// Tagging a JPEG with the sRGB profile, so that a browser does not have to guess the colours of the preview.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <string>

namespace mart {

/**
 * The JPEG with an embedded sRGB profile (an APP2 `ICC_PROFILE` segment after the JFIF header). A JPEG that
 * already has a profile, and anything that is not a JPEG, is returned as it is.
 */
std::string tagAsSRGB(const std::string &jpeg);

} // namespace mart
