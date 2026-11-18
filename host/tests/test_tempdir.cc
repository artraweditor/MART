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

// Unit tests of the temporary folders.
#include "../src/tempdir.h"
#include <cstdlib>
#include <iostream>
#include <sys/stat.h>
#include <unistd.h>

static int failures = 0;
#define CHECK(c)                                                               \
    do {                                                                       \
        if (!(c)) {                                                            \
            ++failures;                                                        \
            std::cerr << __FILE__ << ":" << __LINE__                           \
                      << ": CHECK failed: " #c "\n";                           \
        }                                                                      \
    } while (0)

static bool isDir(const std::string &p)
{
    struct stat st;
    return stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

int main()
{
    // in $TMPDIR, whatever its trailing slashes
    char base[] = "/tmp/mart-test-tempdir-XXXXXX";
    CHECK(mkdtemp(base));
    const std::string b = base;
    setenv("TMPDIR", (b + "//").c_str(), 1);
    std::string d = mart::makeTempDir("mart-");
    CHECK(d.compare(0, b.size() + 6, b + "/mart-") == 0 && isDir(d));
    CHECK(d != mart::makeTempDir("mart-"));
    // not set, or empty: /tmp
    unsetenv("TMPDIR");
    std::string t = mart::makeTempDir("mart-test-");
    CHECK(t.compare(0, 15, "/tmp/mart-test-") == 0 && isDir(t));
    rmdir(t.c_str());
    // a folder that cannot be made
    setenv("TMPDIR", (b + "/missing").c_str(), 1);
    bool thrown = false;
    try {
        mart::makeTempDir("mart-");
    } catch (const std::runtime_error &) {
        thrown = true;
    }
    CHECK(thrown);
    return failures ? 1 : (std::cout << "tempdir tests: ok\n", 0);
}
