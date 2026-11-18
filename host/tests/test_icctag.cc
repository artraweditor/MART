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

// Unit tests of the sRGB tagging of JPEGs.
#include "../src/icctag.h"
#include "../src/srgb_icc.h"
#include <iostream>

using namespace mart;

static int failures = 0;
#define CHECK(c)                                                               \
    do {                                                                       \
        if (!(c)) {                                                            \
            ++failures;                                                        \
            std::cerr << __FILE__ << ":" << __LINE__                           \
                      << ": CHECK failed: " #c "\n";                           \
        }                                                                      \
    } while (0)

static std::string seg(unsigned char marker, const std::string &payload)
{
    std::string s = {char(0xff), char(marker)};
    size_t len = payload.size() + 2;
    s += char(len >> 8);
    s += char(len & 0xff);
    return s + payload;
}
static const std::string SOI = {char(0xff), char(0xd8)};
static const std::string SCAN =
    seg(0xda, std::string("\x01\x01\x00\x00\x3f\x00", 6)) + "data" +
    std::string({char(0xff), char(0xd9)});
static const std::string JFIF =
    seg(0xe0, std::string("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", 14));
static const std::string EXIF = seg(0xe1, std::string("Exif\0\0abcd", 10));

// the profile's bytes of the first ICC segment, "" if none
static std::string profileOf(const std::string &jpeg, size_t *where = nullptr)
{
    size_t i = 2;
    while (i + 4 <= jpeg.size() && (unsigned char)jpeg[i] == 0xff &&
           (unsigned char)jpeg[i + 1] != 0xda) {
        size_t len =
            ((unsigned char)jpeg[i + 2] << 8) | (unsigned char)jpeg[i + 3];
        if ((unsigned char)jpeg[i + 1] == 0xe2 &&
            jpeg.compare(i + 4, 11, "ICC_PROFILE") == 0) {
            if (where) *where = i;
            return jpeg.substr(i + 4 + 14, len - 2 - 14);
        }
        i += 2 + len;
    }
    return "";
}

int main()
{
    const std::string profile(reinterpret_cast<const char *>(SRGB_ICC),
                              SRGB_ICC_SIZE);

    // after the JFIF header, before the other segments and the scan
    std::string t = tagAsSRGB(SOI + JFIF + SCAN);
    size_t at = 0;
    CHECK(profileOf(t, &at) == profile);
    CHECK(at == 2 + JFIF.size());
    CHECK(t.compare(0, 2 + JFIF.size(), SOI + JFIF) == 0);
    CHECK(t.size() ==
          (SOI + JFIF + SCAN).size() + 2 + 2 + 12 + 2 + profile.size());
    CHECK(t.compare(t.size() - SCAN.size(), SCAN.size(), SCAN) ==
          0);  // the scan is untouched

    // without JFIF: right after SOI; Exif stays where it is
    t = tagAsSRGB(SOI + EXIF + SCAN);
    CHECK(profileOf(t, &at) == profile && at == 2);
    CHECK(t.find(EXIF) == 2 + 4 + 12 + 2 + profile.size());

    // tagging twice changes nothing; a profile that is there is respected
    std::string once = tagAsSRGB(SOI + JFIF + SCAN);
    CHECK(tagAsSRGB(once) == once);
    std::string other = SOI + JFIF +
                        seg(0xe2, std::string("ICC_PROFILE\0\x01\x01xyz", 17)) +
                        SCAN;
    CHECK(tagAsSRGB(other) == other);

    // not a JPEG, or a broken one: unchanged
    CHECK(tagAsSRGB("") == "");
    CHECK(tagAsSRGB("PNG....") == "PNG....");
    CHECK(tagAsSRGB(SOI) == SOI);
    std::string broken =
        SOI + std::string({char(0xff), char(0xe0), char(0x7f), char(0xff)}) +
        "xx";
    CHECK(tagAsSRGB(broken) == broken);

    if (failures == 0) std::cout << "icctag: ok\n";
    return failures ? 1 : 0;
}
