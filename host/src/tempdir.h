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

// A private temporary folder, in $TMPDIR (the only place that an app of iOS can
// write temporary files to; /tmp elsewhere).
#pragma once
#include <string>

namespace mart {

/**
 * Make a new folder `<prefix>XXXXXX` in $TMPDIR (or /tmp if it is not set) and
 * return its path. Throws std::runtime_error.
 */
std::string makeTempDir(const std::string &prefix);

}  // namespace mart
