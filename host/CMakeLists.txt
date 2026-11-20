#
#  This file is part of MART.
#
#  Copyright 2026 Alberto Griggio <alberto.griggio@gmail.com>
#
#  MART is free software: you can redistribute it and/or modify
#  it under the terms of the GNU General Public License as published by
#  the Free Software Foundation, either version 3 of the License, or
#  (at your option) any later version.
#
#  MART is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with MART.  If not, see <http://www.gnu.org/licenses/>.

cmake_minimum_required(VERSION 3.16)
project(mart-host CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
find_package(Threads REQUIRED)
# everything but main() is a library, so that an app can embed the host
add_library(mart-host STATIC src/app.cc src/session.cc src/editor.cc src/arp.cc
    src/profiles.cc src/luts.cc src/halation.cc src/retouch.cc src/sections.cc
    src/icctag.cc src/exportreq.cc src/exporter.cc src/libart_dyn.cc
    src/tempdir.cc)
target_include_directories(mart-host PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(mart-host PUBLIC Threads::Threads ${CMAKE_DL_LIBS})
target_compile_options(mart-host PRIVATE -Wall -Wextra)
# the version of MART shown in the About tab; set it with -DMART_VERSION=...
set(MART_VERSION "0.1.0" CACHE STRING "Version of MART reported by the host")
target_compile_definitions(mart-host PRIVATE MART_VERSION="${MART_VERSION}")
# MART_IOS / MART_EMBED: only the static library, for embedding in the iOS app (see ios/build-host.sh)
# or the Android app (see android/build-native.sh)
option(MART_IOS "Build only the host library, for embedding in the iOS app" OFF)
option(MART_EMBED "Build only the host library, for embedding in an app" OFF)
if(MART_IOS OR MART_EMBED)
  return()
endif()
add_executable(mart src/main.cc)
target_link_libraries(mart PRIVATE mart-host)

enable_testing()
add_executable(test_arp tests/test_arp.cc src/arp.cc)
target_include_directories(test_arp PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(test_arp PRIVATE
    MART_KNOWN_KEYS="${CMAKE_CURRENT_SOURCE_DIR}/data/known_keys.json")
add_test(NAME arp COMMAND test_arp)

add_executable(test_halation tests/test_halation.cc src/halation.cc)
target_include_directories(test_halation PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME halation COMMAND test_halation)

add_executable(test_sections tests/test_sections.cc src/sections.cc
    src/halation.cc src/retouch.cc)
target_include_directories(test_sections PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME sections COMMAND test_sections)

add_executable(test_retouch tests/test_retouch.cc src/retouch.cc)
target_include_directories(test_retouch PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME retouch COMMAND test_retouch)

add_executable(test_tempdir tests/test_tempdir.cc src/tempdir.cc)
target_include_directories(test_tempdir PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME tempdir COMMAND test_tempdir)

add_executable(test_profiles tests/test_profiles.cc src/profiles.cc)
target_include_directories(test_profiles PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME profiles COMMAND test_profiles)

add_executable(test_luts tests/test_luts.cc src/luts.cc)
target_include_directories(test_luts PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME luts COMMAND test_luts)

add_executable(test_icctag tests/test_icctag.cc src/icctag.cc)
target_include_directories(test_icctag PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME icctag COMMAND test_icctag)

add_executable(test_export tests/test_export.cc src/exportreq.cc)
target_include_directories(test_export PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME export COMMAND test_export)
