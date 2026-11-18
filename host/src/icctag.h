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

// Tagging a JPEG with the sRGB profile, so that a browser does not have to
// guess the colours of the preview.
#pragma once
#include <string>

namespace mart {

/**
 * The JPEG with an embedded sRGB profile (an APP2 `ICC_PROFILE` segment after
 * the JFIF header). A JPEG that already has a profile, and anything that is not
 * a JPEG, is returned as it is.
 */
std::string tagAsSRGB(const std::string &jpeg);

}  // namespace mart
