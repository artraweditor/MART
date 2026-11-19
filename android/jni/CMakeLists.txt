# libmart.so for the Android app: the JNI shim + the MART host (host/, as a static library).
# Built by android/build-native.sh with the NDK toolchain.
cmake_minimum_required(VERSION 3.16)
project(mart-jni CXX)
set(MART_EMBED ON CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../host ${CMAKE_CURRENT_BINARY_DIR}/host)
add_library(mart SHARED mart_jni.cc)
target_link_libraries(mart PRIVATE mart-host log)
target_link_options(mart PRIVATE -Wl,-z,max-page-size=16384 -Wl,--exclude-libs,ALL)
