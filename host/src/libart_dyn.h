// MART host: runtime loader for libART (see ~/src/ART/doc/libart.md).
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace mart {

// failure of the library itself (no server, connection lost, ...), as opposed
// to a command that ran and failed
struct ArtError: std::runtime_error {
    int code;
    ArtError(int c, const std::string &m): std::runtime_error(m), code(c) {}
};

struct Result {
    int code = 0;      // 0 ok, 1 the command failed
    std::string out;   // one JSON line on success: {"ok":true,"result":...}
    std::string err;
    bool ok() const { return code == 0; }
};

struct EngineOptions {
    bool inprocess = true;
    std::string socket;    // remote: socket path (empty: default)
    std::string data_dir;  // inprocess: ART's data files
    std::string gpu;       // inprocess: auto|off|force (empty: from ART options)
    int timeout_ms = -1;   // remote
    std::string library;   // explicit libART path
};

// An ART_engine. Not thread safe by itself: one worker thread must own it.
class Engine {
public:
    static std::unique_ptr<Engine> create(const EngineOptions &o);  // throws ArtError
    ~Engine();
    Result run(const std::vector<std::string> &argv);  // throws ArtError
    static std::string version();
    static bool hasInprocess();
private:
    Engine() = default;
    void *handle_ = nullptr;
};

} // namespace mart
