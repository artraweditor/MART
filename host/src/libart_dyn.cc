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

#include "libart_dyn.h"
#include <cstdlib>
#include <mutex>
#include <dlfcn.h>
#include <unistd.h>
#include <libgen.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

#ifdef __APPLE__
#define LIBNAME "/libART.dylib"
#else
#define LIBNAME "/libART.so"
#endif

namespace mart {
namespace {

struct Api {
    void *(*options_new)();
    void (*options_free)(void *);
    int (*set_remote)(void *, const char *);
    int (*set_inprocess)(void *, const char *, const char *, const char *);
    int (*set_timeout)(void *, int);
    int (*set_gpu)(void *, const char *);
    const char *(*options_error)(const void *);
    int (*options_error_code)(const void *);
    void *(*engine_create)(void *);
    void (*engine_destroy)(void *);
    const char *(*engine_error)(const void *);
    int (*exec_cmd_result)(void *, const char *const *, void **);
    const char *(*result_out)(const void *);
    size_t (*result_out_len)(const void *);
    const char *(*result_err)(const void *);
    size_t (*result_err_len)(const void *);
    void (*result_free)(void *);
    const char *(*strerror)(int);
    const char *(*version)();
    int (*has_backend)(int);
};

Api api;
bool loaded = false;
std::mutex load_mutex;

std::string exeDir()
{
    char buf[4096];
#ifdef __APPLE__
    uint32_t n = sizeof(buf);
    if (_NSGetExecutablePath(buf, &n) != 0) return ".";
#else
    ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
    if (n <= 0) return ".";
    buf[n] = 0;
#endif
    char *r = realpath(buf, nullptr);
    std::string p = r ? r : buf;
    free(r);
    return p.substr(0, p.rfind('/'));
}

template <class T> void sym(void *lib, const char *name, T &out)
{
    out = reinterpret_cast<T>(dlsym(lib, name));
    if (!out) throw ArtError(10, std::string("libART lacks ") + name);
}

void load(const std::string &explicit_path)
{
    std::lock_guard<std::mutex> g(load_mutex);
    if (loaded) return;
    std::vector<std::string> cand;
    if (!explicit_path.empty()) cand.push_back(explicit_path);
    if (const char *e = getenv("ART_LIBRARY")) cand.push_back(e);
    cand.push_back(exeDir() + LIBNAME);
    cand.push_back(std::string(LIBNAME).substr(1));
    void *lib = nullptr;
    std::string last;
    for (auto &c : cand) {
        if (c[0] == '/' && access(c.c_str(), R_OK) != 0) continue;
        lib = dlopen(c.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (lib) break;
        last = dlerror();
    }
    if (!lib)
        throw ArtError(
            8, "cannot load libART (use --library or ART_LIBRARY): " + last);
    sym(lib, "ART_options_new", api.options_new);
    sym(lib, "ART_options_free", api.options_free);
    sym(lib, "ART_options_set_remote", api.set_remote);
    sym(lib, "ART_options_set_inprocess", api.set_inprocess);
    sym(lib, "ART_options_set_timeout", api.set_timeout);
    sym(lib, "ART_options_set_gpu", api.set_gpu);
    sym(lib, "ART_options_error", api.options_error);
    sym(lib, "ART_options_error_code", api.options_error_code);
    sym(lib, "ART_engine_create", api.engine_create);
    sym(lib, "ART_engine_destroy", api.engine_destroy);
    sym(lib, "ART_engine_error", api.engine_error);
    sym(lib, "ART_exec_cmd_result", api.exec_cmd_result);
    sym(lib, "ART_result_out", api.result_out);
    sym(lib, "ART_result_out_len", api.result_out_len);
    sym(lib, "ART_result_err", api.result_err);
    sym(lib, "ART_result_err_len", api.result_err_len);
    sym(lib, "ART_result_free", api.result_free);
    sym(lib, "ART_strerror", api.strerror);
    sym(lib, "ART_version", api.version);
    sym(lib, "ART_has_backend", api.has_backend);
    loaded = true;
}

constexpr int ART_ERR_COMMAND = 1;

}  // namespace

std::unique_ptr<Engine> Engine::create(const EngineOptions &o)
{
    load(o.library);
    void *opt = api.options_new();
    if (!opt) throw ArtError(9, "out of memory");
    struct Guard {
        void *p;
        ~Guard() { api.options_free(p); }
    } guard{opt};
    auto check = [&](int rc) {
        if (rc != 0) throw ArtError(rc, api.strerror(rc));
    };
    if (o.inprocess) {
        check(api.set_inprocess(
            opt, o.data_dir.empty() ? nullptr : o.data_dir.c_str(), nullptr,
            nullptr));
        if (!o.gpu.empty()) check(api.set_gpu(opt, o.gpu.c_str()));
    } else {
        check(
            api.set_remote(opt, o.socket.empty() ? nullptr : o.socket.c_str()));
        check(api.set_timeout(opt, o.timeout_ms));
    }
    void *h = api.engine_create(opt);
    if (!h) {
        int rc = api.options_error_code(opt);
        throw ArtError(rc ? rc : 10, api.options_error(opt));
    }
    std::unique_ptr<Engine> e(new Engine);
    e->handle_ = h;
    return e;
}

Engine::~Engine()
{
    if (handle_) api.engine_destroy(handle_);
}

Result Engine::run(const std::vector<std::string> &args)
{
    if (args.empty()) throw ArtError(2, "no command");
    std::vector<const char *> argv;
    for (auto &a : args) argv.push_back(a.c_str());
    argv.push_back(nullptr);
    void *res = nullptr;
    int rc = api.exec_cmd_result(handle_, argv.data(), &res);
    Result r;
    r.code = rc;
    if (res) {
        r.out.assign(api.result_out(res), api.result_out_len(res));
        r.err.assign(api.result_err(res), api.result_err_len(res));
        api.result_free(res);
    }
    if (rc != 0 && rc != ART_ERR_COMMAND) {
        const char *m = api.engine_error(handle_);
        throw ArtError(rc, m && *m ? m : api.strerror(rc));
    }
    return r;
}

std::string Engine::version() { return loaded ? api.version() : ""; }
bool Engine::hasInprocess() { return loaded && api.has_backend(1) == 1; }

}  // namespace mart
