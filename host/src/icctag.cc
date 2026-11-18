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

#include "icctag.h"
#include "srgb_icc.h"
#include <cstring>

namespace mart {

namespace {
const char ICC_ID[] = "ICC_PROFILE";  // followed by a NUL in the segment
}

std::string tagAsSRGB(const std::string &jpeg)
{
    const auto *b = reinterpret_cast<const unsigned char *>(jpeg.data());
    const size_t n = jpeg.size();
    if (n < 4 || b[0] != 0xff || b[1] != 0xd8) return jpeg;

    // walk the segments up to the scan: look for a profile, and for where to
    // put ours (after SOI and a JFIF header)
    size_t at = 2;
    size_t i = 2;
    while (i + 4 <= n && b[i] == 0xff) {
        const unsigned char m = b[i + 1];
        if (m == 0xda || m == 0xd9)
            break;  // the scan (or the end): the header is over
        const size_t len = (size_t(b[i + 2]) << 8) | b[i + 3];
        if (len < 2 || i + 2 + len > n)
            return jpeg;  // not a JPEG we understand: leave it alone
        if (m == 0xe2 && len >= 2 + sizeof ICC_ID &&
            std::memcmp(b + i + 4, ICC_ID, sizeof ICC_ID) == 0)
            return jpeg;
        if (i == 2 && m == 0xe0) at = i + 2 + len;  // JFIF must come first
        i += 2 + len;
    }

    // one segment holds up to 65533 bytes after its length field: 2 (length) +
    // 12 (id) + 2 (sequence) is the overhead
    if (SRGB_ICC_SIZE > 65533 - 14) return jpeg;
    const size_t len = 2 + sizeof ICC_ID + 2 + SRGB_ICC_SIZE;
    std::string seg;
    seg.reserve(2 + len);
    seg += static_cast<char>(0xff);
    seg += static_cast<char>(0xe2);
    seg += static_cast<char>(len >> 8);
    seg += static_cast<char>(len & 0xff);
    seg.append(ICC_ID, sizeof ICC_ID);  // with its NUL
    seg += static_cast<char>(1);        // chunk 1 of 1
    seg += static_cast<char>(1);
    seg.append(reinterpret_cast<const char *>(SRGB_ICC), SRGB_ICC_SIZE);
    std::string out = jpeg;
    out.insert(at, seg);
    return out;
}

}  // namespace mart
