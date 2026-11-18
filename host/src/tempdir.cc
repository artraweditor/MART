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

#include "tempdir.h"
#include <cstdlib>
#include <stdexcept>
#include <unistd.h>
#include <vector>

namespace mart {

std::string makeTempDir(const std::string &prefix)
{
    const char *env = std::getenv("TMPDIR");
    std::string base = env && *env ? env : "/tmp";
    while (base.size() > 1 && base.back() == '/') base.pop_back();
    std::string t = base + "/" + prefix + "XXXXXX";
    std::vector<char> buf(t.begin(), t.end());
    buf.push_back('\0');
    if (!mkdtemp(buf.data()))
        throw std::runtime_error("cannot create a temporary directory in " +
                                 base);
    return buf.data();
}

}  // namespace mart
