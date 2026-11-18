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

// Unit tests of the folder of profiles.
#include "../src/profiles.h"
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <sys/stat.h>
#include <unistd.h>

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

static std::string read(const std::string &p)
{
    std::ifstream f(p);
    std::stringstream s;
    s << f.rdbuf();
    return s.str();
}
static bool exists(const std::string &p)
{
    struct stat st;
    return stat(p.c_str(), &st) == 0;
}

int main()
{
    char tmpl[] = "/tmp/mart-test-XXXXXX";
    const std::string d = mkdtemp(tmpl);
    const std::string dir =
        d + "/config/MART/profiles";  // not there yet: made by the first save

    Profiles p({{"mine", dir}});
    auto list = p.list();
    CHECK(list.size() == 1 && list[0]["id"] == ":neutral" &&
          list[0]["source"] == "builtin");  // only what is built in

    // saving: the name is made safe, the folder is made
    auto e = p.save("../My Look.arp", "[Saturation]\nEnabled=true\n", false);
    CHECK(e["name"] == "_My Look" &&
          e["id"] == "d0:_My Look.arp");  // no path, nothing hidden
    CHECK(exists(dir + "/_My Look.arp"));
    CHECK(read(dir + "/_My Look.arp") == "[Saturation]\nEnabled=true\n");
    CHECK(e["source"] == "mine" && e["default"] == false);
    auto f = p.save("warm", "[Exposure]\nEnabled=true\n", false);
    CHECK(f["name"] == "warm" && f["id"] == "d0:warm.arp");
    list = p.list();
    CHECK(list.size() == 3 &&
          list[1]["source"] == "mine");  // Neutral and two of mine

    // the same name: refused, unless it is to be replaced
    bool exists409 = false;
    try {
        p.save("warm", "[Exposure]\nEnabled=false\n", false);
    } catch (const ProfileExists &) {
        exists409 = true;
    }
    CHECK(exists409);
    CHECK(read(dir + "/warm.arp") == "[Exposure]\nEnabled=true\n");
    p.save("warm", "[Exposure]\nEnabled=false\n", true);
    CHECK(read(dir + "/warm.arp") == "[Exposure]\nEnabled=false\n");

    // nothing usable
    for (auto &bad : {std::string(""), std::string("..."), std::string("  ")}) {
        bool r = false;
        try {
            p.save(bad, "[A]\nb=1\n", false);
        } catch (const std::invalid_argument &) {
            r = true;
        }
        CHECK(r);
    }
    bool nothing = false;
    try {
        p.save("empty", "", false);
    } catch (const std::invalid_argument &) {
        nothing = true;
    }
    CHECK(nothing && !exists(dir + "/empty.arp"));
    CHECK(Profiles::sanitizeName("a/b\\c") == "a_b_c");
    CHECK(Profiles::sanitizeName("x.arp") == "x");
    CHECK(Profiles::sanitizeName(std::string(300, 'a')).size() <= 80);

    // the default
    CHECK(p.defaultPath().empty());
    p.setDefault("d0:warm.arp");
    CHECK(p.defaultPath() == dir + "/warm.arp");
    list = p.list();
    int stars = 0;
    for (auto &x : list)
        if (x["default"] == true) {
            ++stars;
            CHECK(x["id"] == "d0:warm.arp");
        }
    CHECK(stars == 1);
    CHECK(!exists(dir + "/.default.arp"));
    // the file that keeps it is not a profile
    for (auto &x : p.list()) CHECK(x["name"] != ".default");
    // only a profile of the folder
    for (auto &bad : {std::string(":neutral"), std::string("u1"),
                      std::string("d0:nope.arp"), std::string("d0:../x.arp"),
                      std::string("d1:warm.arp")}) {
        bool r = false;
        try {
            p.setDefault(bad);
        } catch (const std::invalid_argument &) {
            r = true;
        }
        CHECK(r);
    }
    CHECK(p.defaultPath() == dir + "/warm.arp");  // unchanged by the refusals
    // a default that is gone is no default
    std::remove((dir + "/warm.arp").c_str());
    CHECK(p.defaultPath().empty());
    p.setDefault("d0:_My Look.arp");
    CHECK(!p.defaultPath().empty());
    p.setDefault("");
    CHECK(p.defaultPath().empty());

    // renaming: the file moves, the default follows it, a clash is refused
    p.save("cool", "[Saturation]\nEnabled=true\n", false);
    p.setDefault("d0:cool.arp");
    auto rn = p.rename("d0:cool.arp", "../Cool Look");
    CHECK(rn["id"] == "d0:_Cool Look.arp" && rn["name"] == "_Cool Look" &&
          rn["default"] == true);
    CHECK(!exists(dir + "/cool.arp") &&
          read(dir + "/_Cool Look.arp") == "[Saturation]\nEnabled=true\n");
    CHECK(p.defaultPath() == dir + "/_Cool Look.arp");
    bool clash = false;
    try {
        p.rename("d0:_Cool Look.arp", "_My Look");
    } catch (const ProfileExists &) {
        clash = true;
    }
    CHECK(clash && exists(dir + "/_Cool Look.arp"));
    auto same = p.rename("d0:_Cool Look.arp",
                         "_Cool Look");  // the same name: nothing to do
    CHECK(same["id"] == "d0:_Cool Look.arp");
    p.rename("d0:_Cool Look.arp", "_cool look");  // only the case
    CHECK(exists(dir + "/_cool look.arp"));
    for (auto &bad : {std::string(""), std::string("..."), std::string("  ")}) {
        bool r = false;
        try {
            p.rename("d0:_cool look.arp", bad);
        } catch (const std::invalid_argument &) {
            r = true;
        }
        CHECK(r);
    }
    for (auto &bad : {std::string(":neutral"), std::string("u1"),
                      std::string("d1:x.arp"), std::string("d0:../x.arp")}) {
        bool r = false;
        try {
            p.rename(bad, "x");
        } catch (const std::exception &) {
            r = true;
        }
        CHECK(r);
    }
    bool gone = false;
    try {
        p.rename("d0:missing.arp", "x");
    } catch (const std::out_of_range &) {
        gone = true;
    }
    CHECK(gone);

    // deleting: the file goes, and the default with it
    p.remove("d0:_cool look.arp");
    CHECK(!exists(dir + "/_cool look.arp") && !exists(dir + "/.default"));
    CHECK(p.defaultPath().empty());
    bool again = false;
    try {
        p.remove("d0:_cool look.arp");
    } catch (const std::out_of_range &) {
        again = true;
    }
    CHECK(again);
    for (auto &bad : {std::string(":neutral"), std::string("u1"),
                      std::string("d0:../x.arp")}) {
        bool r = false;
        try {
            p.remove(bad);
        } catch (const std::exception &) {
            r = true;
        }
        CHECK(r);
    }
    // a profile that is not the default can be deleted and the default stays
    p.save("keep", "[A]\nb=1\n", false);
    p.save("drop", "[A]\nb=1\n", false);
    p.setDefault("d0:keep.arp");
    p.remove("d0:drop.arp");
    CHECK(p.defaultPath() == dir + "/keep.arp");
    p.setDefault("");

    // importing a profile from a file: stored in the folder, under the name
    // given, if it looks like a profile
    auto imp = p.import("from a file.arp", "[Saturation]\nEnabled=true\n");
    CHECK(imp["id"] == "d0:from a file.arp" && imp["source"] == "mine" &&
          imp["default"] == false);
    CHECK(read(dir + "/from a file.arp") == "[Saturation]\nEnabled=true\n");
    bool taken = false;
    try {
        p.import("from a file", "[Saturation]\nEnabled=true\n");
    } catch (const ProfileExists &) {
        taken = true;
    }
    CHECK(taken);
    for (auto &bad : {std::string("this is not a profile"), std::string(""),
                      std::string("a=b\n"), std::string("[x\n"),
                      std::string("[A]\n") + std::string(1, '\0')}) {
        bool r = false;
        try {
            p.import("bad", bad);
        } catch (const std::invalid_argument &) {
            r = true;
        }
        CHECK(r);
    }
    CHECK(!exists(dir + "/bad.arp"));
    CHECK(p.import("crlf", "[A]\r\nb=1\r\n")["name"] == "crlf");
    bool big = false;
    try {
        p.import("big", "[A]\n" + std::string(1 << 20, 'x'));
    } catch (const std::invalid_argument &) {
        big = true;
    }
    CHECK(big);

    // no folder at all
    Profiles none({});
    bool r = false;
    try {
        none.save("x", "[A]\nb=1\n", false);
    } catch (const std::invalid_argument &) {
        r = true;
    }
    CHECK(r);

    std::string cmd = "rm -rf " + d;
    if (std::system(cmd.c_str()) != 0)
        std::cerr << "cannot remove " << d << "\n";
    if (failures == 0) std::cout << "profiles: ok\n";
    return failures ? 1 : 0;
}
