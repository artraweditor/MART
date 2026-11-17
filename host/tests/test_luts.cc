// Unit tests of the LUT catalog. SPDX-License-Identifier: GPL-3.0-or-later
#include "../src/luts.h"
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sys/stat.h>
#include <unistd.h>

using namespace mart;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { ++failures; std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #c "\n"; } } while (0)

static void write(const std::string &p, const std::string &t) { std::ofstream(p) << t; }

int main()
{
    char tmpl[] = "/tmp/mart-test-XXXXXX";
    std::string d = mkdtemp(tmpl);
    mkdir((d + "/luts").c_str(), 0700);
    mkdir((d + "/luts/sub").c_str(), 0700);
    mkdir((d + "/up").c_str(), 0700);
    write(d + "/luts/film.cube", "x");  // not a format ART reads from a folder: cube is not offered
    write(d + "/luts/a.ctl", "x");
    write(d + "/luts/sub/b.png", "x");
    write(d + "/luts/.hidden.ctl", "x");
    write(d + "/luts/readme.txt", "x");

    Luts l({{"bundled", d + "/luts"}}, d + "/up");
    auto list = l.list();
    CHECK(list.size() == 2);
    CHECK(list[0]["name"] == "a.ctl" && list[0]["source"] == "bundled" && list[0]["id"] == "d0:a.ctl");
    CHECK(list[1]["name"] == "sub/b.png");
    CHECK(l.path("d0:a.ctl") == d + "/luts/a.ctl");
    CHECK(l.path("d0:sub/b.png") == d + "/luts/sub/b.png");
    CHECK(l.path("d0:../x.ctl").empty());
    CHECK(l.path("d0:/etc/passwd").empty());
    CHECK(l.path("d1:a.ctl").empty());                  // no such folder
    CHECK(l.path("d0:readme.txt").empty());             // not a LUT
    CHECK(l.path("d0:missing.ctl").empty());
    CHECK(l.path("u1").empty() && l.path("").empty() && l.path("../u1").empty());

    auto up = l.upload("../my film.PNG", "bytes");
    CHECK(up["id"] == "u1" && up["name"] == "_my film.PNG" && up["source"] == "uploaded");
    CHECK(l.path("u1") == d + "/up/u1/_my film.PNG");
    CHECK(l.list().size() == 3);
    bool refused = false;
    try { l.upload("evil.sh", "x"); } catch (const std::invalid_argument &) { refused = true; }
    CHECK(refused);
    refused = false;
    try { l.upload("a.ctl", ""); } catch (const std::invalid_argument &) { refused = true; }
    CHECK(refused);
    refused = false;
    try { l.upload("...", "x"); } catch (const std::invalid_argument &) { refused = true; }
    CHECK(refused);
    l.clear();
    CHECK(l.path("u1").empty());
    rmdir((d + "/up").c_str());

    std::string cmd = "rm -rf " + d;
    if (std::system(cmd.c_str()) != 0) std::cerr << "cannot remove " << d << "\n";
    if (failures == 0) std::cout << "luts: ok\n";
    return failures ? 1 : 0;
}
