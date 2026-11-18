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

// Unit tests of the folder of LUTs and the URIs of its files.
#include "../src/luts.h"
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
template <class E, class F> static bool throws(F f)
{
    try {
        f();
    } catch (const E &) {
        return true;
    } catch (...) {
        return false;
    }
    return false;
}

int main()
{
    char tmpl[] = "/tmp/mart-test-XXXXXX";
    const std::string d = mkdtemp(tmpl);
    const std::string dir =
        d + "/config/MART/luts";  // not there yet: made by the first import
    Luts l(dir);
    CHECK(l.list().empty());

    // importing: the name is made safe, the folder is made, the extension must
    // be a LUT's
    auto a = l.import("../my film.PNG", "bytes");
    CHECK(a["id"] == "d0:_my film.PNG" && a["name"] == "_my film.PNG" &&
          a["source"] == "mine");
    CHECK(read(dir + "/_my film.PNG") == "bytes");
    CHECK(l.path("d0:_my film.PNG") == dir + "/_my film.PNG");
    l.import("grade.ctl", "// script");
    l.import("a.cube.clf", "<clf/>");
    auto list = l.list();
    CHECK(list.size() == 3 && list[0]["name"] == "_my film.PNG" &&
          list[1]["name"] == "a.cube.clf" && list[2]["name"] == "grade.ctl");
    l.import("Zed.ctl", "z");
    l.import("alpha.ctl", "a");
    list = l.list();
    CHECK(list[list.size() - 1]["name"] == "Zed.ctl" &&
          list[list.size() - 2]["name"] == "grade.ctl");  // ignoring case
    l.remove("d0:Zed.ctl");
    l.remove("d0:alpha.ctl");
    CHECK(throws<ProfileExists>([&] { l.import("grade.ctl", "other"); }));
    CHECK(read(dir + "/grade.ctl") == "// script");
    CHECK(throws<std::invalid_argument>([&] { l.import("evil.sh", "x"); }));
    CHECK(throws<std::invalid_argument>([&] { l.import("noext", "x"); }));
    CHECK(throws<std::invalid_argument>([&] { l.import("a.ctl", ""); }));
    CHECK(throws<std::invalid_argument>([&] { l.import("...", "x"); }));
    CHECK(!exists(dir + "/evil.sh"));
    // ids never leave the folder
    for (auto &bad :
         {std::string("d0:../x.ctl"), std::string("d0:/etc/passwd"),
          std::string("d1:grade.ctl"), std::string("u1"), std::string(""),
          std::string("d0:missing.ctl"), std::string("d0:readme.txt")})
        CHECK(l.path(bad).empty());

    // renaming: the extension stays, the format with it
    auto r = l.rename("d0:grade.ctl", "Warm Look");
    CHECK(r["id"] == "d0:Warm Look.ctl" && r["name"] == "Warm Look.ctl");
    CHECK(!exists(dir + "/grade.ctl") &&
          read(dir + "/Warm Look.ctl") == "// script");
    CHECK(l.rename("d0:Warm Look.ctl", "cool.ctl")["name"] ==
          "cool.ctl");  // typed with the extension
    CHECK(l.rename("d0:cool.ctl", "cool.png")["name"] ==
          "cool.png.ctl");  // another extension is only a part of the name
    l.import("x.ctl", "1");
    CHECK(throws<ProfileExists>(
        [&] { l.rename("d0:cool.png.ctl", "x"); }));  // x.ctl exists
    CHECK(exists(dir + "/cool.png.ctl") && read(dir + "/x.ctl") == "1");
    CHECK(l.rename("d0:cool.png.ctl", "a.cube")["name"] ==
          "a.cube.ctl");  // a.cube.clf is another file
    CHECK(l.rename("d0:a.cube.ctl", "a.cube.ctl")["name"] ==
          "a.cube.ctl");  // the same name: nothing to do
    CHECK(
        throws<std::invalid_argument>([&] { l.rename("d0:a.cube.ctl", ""); }));
    CHECK(throws<std::invalid_argument>(
        [&] { l.rename("d0:a.cube.ctl", "..."); }));
    CHECK(throws<std::out_of_range>([&] { l.rename("d0:nope.ctl", "x"); }));
    CHECK(throws<std::out_of_range>([&] { l.rename("d0:../x.ctl", "x"); }));
    CHECK(l.rename("d0:a.cube.ctl", "A.CUBE")["name"] ==
          "A.CUBE.ctl");  // only the case

    // deleting
    l.remove("d0:A.CUBE.ctl");
    CHECK(!exists(dir + "/A.CUBE.ctl"));
    CHECK(throws<std::out_of_range>([&] { l.remove("d0:A.CUBE.ctl"); }));
    CHECK(throws<std::out_of_range>([&] { l.remove("d0:../x.ctl"); }));

    // the URI of a LUT of the folder: the host R, the rest relative to the
    // folder (as ART writes its own)
    CHECK(l.toUri(dir + "/_my film.PNG") == "file://R/_my%20film.PNG");
    mkdir((dir + "/sub").c_str(), 0755);
    std::ofstream(dir + "/sub/b (1).ctl") << "x";
    CHECK(l.toUri(dir + "/sub/b (1).ctl") == "file://R/sub/b%20(1).ctl");
    CHECK(l.toUri(dir + "/caf\xc3\xa9.ctl") == "file://R/caf%C3%A9.ctl");
    CHECK(l.toUri("/elsewhere/x.ctl").empty() &&
          l.toUri(dir + "x/y.ctl").empty() &&
          l.toUri(dir + "/../y.ctl").empty());
    // and back
    CHECK(l.fromUri("file://R/_my%20film.PNG") == dir + "/_my film.PNG");
    CHECK(l.fromUri("file://R/sub/b%20(1).ctl") == dir + "/sub/b (1).ctl");
    CHECK(l.fromUri(l.toUri(dir + "/caf\xc3\xa9.ctl")) ==
          dir + "/caf\xc3\xa9.ctl");
    CHECK(l.fromUri("file:///abs/x%20y.ctl") == "/abs/x y.ctl");
    CHECK(l.fromUri("file://localhost/abs/x.ctl") == "/abs/x.ctl");
    CHECK(l.fromUri("/abs/path.cube") == "/abs/path.cube");
    CHECK(l.fromUri("sub/rel.cube") ==
          dir + "/sub/rel.cube");  // a relative path: in the folder
    CHECK(l.fromUri("file://R/../etc/passwd")
              .empty());  // never out of the folder
    CHECK(l.fromUri("file://S/luts/x.ctl").empty() &&
          l.fromUri("file://U/x").empty());  // ART's own folders: unknown
    CHECK(l.fromUri("").empty() && l.fromUri("file://noslash").empty());
    setenv("HOME", "/home/someone", 1);
    CHECK(l.fromUri("file://H/.config/ART/luts/x.cube") ==
          "/home/someone/.config/ART/luts/x.cube");

    // in a profile: R becomes an absolute path (for ART it is relative to its
    // own folder), the rest is as it is
    const std::string prof =
        "[Exposure]\nEnabled=true\n\n[Film "
        "Simulation]\nEnabled=true\nClutFilename=file://R/sub/"
        "b%20(1).ctl\nStrength=80\n\n[Other]\nClutFilename=file://R/x\n";
    const std::string resolved = l.resolveInProfile(prof);
    CHECK(resolved ==
          "[Exposure]\nEnabled=true\n\n[Film "
          "Simulation]\nEnabled=true\nClutFilename=" +
              dir +
              "/sub/b "
              "(1).ctl\nStrength=80\n\n[Other]\nClutFilename=file://R/x\n");
    CHECK(l.resolveInProfile(
              "[Film Simulation]\nClutFilename=file:///abs/x.cube\n") ==
          "[Film Simulation]\nClutFilename=file:///abs/x.cube\n");
    CHECK(l.resolveInProfile("[Film Simulation]\nClutFilename=/abs/x.cube\n") ==
          "[Film Simulation]\nClutFilename=/abs/x.cube\n");
    CHECK(l.resolveInProfile("[Film Simulation]\nClutFilename=rel.cube\n") ==
          "[Film Simulation]\nClutFilename=" + dir + "/rel.cube\n");
    CHECK(l.resolveInProfile(
              "[Film Simulation]\r\nClutFilename=file://R/a.ctl\r\n") ==
          "[Film Simulation]\r\nClutFilename=" + dir + "/a.ctl\r\n");
    CHECK(l.resolveInProfile("[Film Simulation]\nClutFilename=\n") ==
          "[Film Simulation]\nClutFilename=\n");
    CHECK(l.resolveInProfile("") == "");

    std::string cmd = "rm -rf " + d;
    if (std::system(cmd.c_str()) != 0)
        std::cerr << "cannot remove " << d << "\n";
    if (failures == 0) std::cout << "luts: ok\n";
    return failures ? 1 : 0;
}
