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

// MART host: serves the web UI and drives ART through libART.
#include "app.h"
#include "editor.h"
#include "exporter.h"
#include "session.h"
#include "worker.h"
#include "third_party/httplib.h"
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <random>
#include <thread>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

namespace mart {

namespace {

// what stop() needs of a running server
std::mutex g_mutex;
std::condition_variable g_cv;
std::function<void()> g_stopper;
std::function<void(const std::string &)> g_addRoot;  // set while a host runs
bool g_stopRequested = false;
bool g_finished = false;

void usage()
{
    std::fputs("usage: mart [options] [IMAGE]\n"
               "  --root DIR       directory images may be opened from "
               "(repeatable; default: IMAGE's folder)\n"
               "  --listen ADDR    address to bind (default 127.0.0.1; "
               "anything else requires the token)\n"
               "  --port N         port (default 8080; 0: any free one)\n"
               "  --www DIR        the built client (default: ../client/dist "
               "next to the binary)\n"
               "  --socket PATH    use a running `ART-cli --server` instead of "
               "the in-process engine\n"
               "  --data DIR       ART's data directory (in-process engine)\n"
               "  --luts DIR       the folder of MART's LUTs and CTL scripts "
               "for the film simulation, where they are imported\n"
               "                   (default: ~/.config/MART/luts)\n"
               "  --profiles DIR   the folder of MART's profiles, where they "
               "are saved (default: ~/.config/MART/profiles)\n"
               "  --art-config DIR ART's configuration folder (in-process "
               "engine; default: ART's own)\n"
               "  --art-cache DIR  ART's cache folder (in-process engine)\n"
               "  --gpu MODE       auto|off|force (in-process engine)\n"
               "  --library PATH   libART (default: $ART_LIBRARY, next to the "
               "binary)\n"
               "  --export-dir DIR keep exported files in DIR (default: a "
               "temporary folder, for downloading only)\n"
               "  --require-token  ask for the token on the loopback address "
               "too (other programs of the machine can reach it)\n"
               "  --token TOKEN    the access token, which is then always "
               "required (default: random, for non-loopback listening)\n",
               stderr);
}

std::string randomToken()
{
    std::random_device rd;
    static const char *hex = "0123456789abcdef";
    std::string t;
    for (int i = 0; i < 24; ++i) t += hex[rd() % 16];
    return t;
}

bool isLoopback(const std::string &a)
{
    return a == "127.0.0.1" || a == "localhost" || a == "::1";
}

void sendJson(httplib::Response &res, const json &j, int status = 200)
{
    res.status = status;
    res.set_content(j.dump(), "application/json");
}

// runs `fn` on the worker and maps failures to JSON errors
template <class F> void serve(Worker &w, httplib::Response &res, F fn)
{
    try {
        fn(w);
    } catch (const ApiError &e) {
        sendJson(res, {{"error", e.what()}}, e.status);
    } catch (const ArtError &e) {
        sendJson(res, {{"error", e.what()}, {"code", e.code}}, 503);
    } catch (const std::exception &e) {
        sendJson(res, {{"error", e.what()}}, 500);
    }
}

int toInt(const httplib::Request &r, const char *k, int d)
{
    return r.has_param(k) ? std::atoi(r.get_param_value(k).c_str()) : d;
}

std::string exeDir(const char *argv0)
{
    char *r = realpath(argv0, nullptr);
    std::string p = r ? r : argv0;
    free(r);
    auto s = p.rfind('/');
    return s == std::string::npos ? "." : p.substr(0, s);
}

}  // namespace

int run(int argc, char **argv, const ReadyFn &ready)
{
    {
        std::lock_guard<std::mutex> g(g_mutex);  // a new run (the app may start
        g_stopRequested = false;                 // the host again)
        g_finished = false;
    }
    EngineOptions eo;
    std::string listen = "127.0.0.1", www, token, image;
    bool requireToken = false;
    int port = 8080;
    std::vector<std::string> roots;
    std::vector<ProfileDir> profileDirs;
    std::string lutDir;
    std::string exportDir;
    bool userProfiles = true, userLuts = true;
    bool remote = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto val = [&]() -> std::string {
            if (i + 1 >= argc) {
                usage();
                std::exit(2);
            }
            return argv[++i];
        };
        if (a == "--root")
            roots.push_back(val());
        else if (a == "--listen")
            listen = val();
        else if (a == "--port")
            port = std::atoi(val().c_str());
        else if (a == "--www")
            www = val();
        else if (a == "--socket") {
            eo.socket = val();
            remote = true;
        } else if (a == "--data")
            eo.data_dir = val();
        else if (a == "--export-dir")
            exportDir = val();
        else if (a == "--profiles") {
            profileDirs.clear();
            profileDirs.push_back({"mine", val()});
            userProfiles = false;
        } else if (a == "--luts") {
            lutDir = val();
            userLuts = false;
        } else if (a == "--art-config")
            eo.config_dir = val();
        else if (a == "--art-cache")
            eo.cache_dir = val();
        else if (a == "--gpu")
            eo.gpu = val();
        else if (a == "--library")
            eo.library = val();
        else if (a == "--token")
            token = val();
        else if (a == "--require-token")
            requireToken = true;
        else if (a == "-h" || a == "--help") {
            usage();
            return 0;
        } else if (a[0] == '-') {
            usage();
            return 2;
        } else
            image = a;
    }
    eo.inprocess = !remote;
    if (!image.empty() && roots.empty()) {
        char *rp = realpath(image.c_str(), nullptr);
        if (!rp) {
            std::fprintf(stderr, "mart: no such file: %s\n", image.c_str());
            return 1;
        }
        image = rp;
        free(rp);
        roots.push_back(image.substr(0, image.rfind('/')));
    }
    if (www.empty()) www = exeDir(argv[0]) + "/../client/dist";
    // anything but the loopback address needs the token; so does a loopback
    // server of a program that other programs of the machine can reach
    const bool needToken =
        !isLoopback(listen) || requireToken || !token.empty();
    if (needToken && token.empty()) token = randomToken();

    if (userProfiles) {
        // MART's own profiles: one folder of the user's (made when the first
        // profile is saved), not ART's
        const char *xdg = std::getenv("XDG_CONFIG_HOME"),
                   *home = std::getenv("HOME");
        if (xdg && *xdg)
            profileDirs.push_back(
                {"mine", std::string(xdg) + "/MART/profiles"});
        else if (home)
            profileDirs.push_back(
                {"mine", std::string(home) + "/.config/MART/profiles"});
    }

    if (userLuts) {
        // MART's own LUTs: one folder of the user's (made when the first one is
        // imported), not ART's
        const char *xdg = std::getenv("XDG_CONFIG_HOME"),
                   *home = std::getenv("HOME");
        if (xdg && *xdg)
            lutDir = std::string(xdg) + "/MART/luts";
        else if (home)
            lutDir = std::string(home) + "/.config/MART/luts";
    }

    Worker worker;
    std::unique_ptr<Session> session;
    try {
        worker
            .submit([&] {
                session =
                    std::make_unique<Session>(eo, roots, profileDirs, lutDir);
            })
            .get();
        if (!image.empty()) worker.submit([&] { session->open(image); }).get();
    } catch (const std::exception &e) {
        std::fprintf(stderr, "mart: %s\n", e.what());
        return 1;
    }

    httplib::Server svr;
    // only SO_REUSEADDR (to restart at once): with SO_REUSEPORT, which the
    // library sets by default, two copies of MART could share the port and a
    // browser would talk to either of them
    svr.set_socket_options([](socket_t sock) {
        int yes = 1;
        setsockopt(sock, SOL_SOCKET, SO_REUSEADDR,
                   reinterpret_cast<const char *>(&yes), sizeof(yes));
    });
    svr.set_payload_max_length(
        Luts::MAX_IMPORT +
        (1u
         << 20));  // only an uploaded LUT is large: see the pre-routing handler
    svr.set_file_extension_and_mimetype_mapping(
        "webmanifest",
        "application/manifest+json");  // the largest body is an uploaded
                                       // profile (1 MiB)
    if (!svr.set_mount_point("/", www))
        std::fprintf(stderr, "mart: warning: client directory not found: %s\n",
                     www.c_str());

    svr.set_pre_routing_handler([needToken, token](const httplib::Request &req,
                                                   httplib::Response &res) {
        // everything but an uploaded LUT is small (the largest other body is a
        // profile of 1 MiB)
        if (req.method == "POST" && req.path != "/api/luts" &&
            req.body.size() > (2u << 20)) {
            sendJson(res, {{"error", "request too large"}}, 413);
            return httplib::Server::HandlerResponse::Handled;
        }
        // a web page of another origin must not drive the API (CSRF, DNS
        // rebinding)
        if (req.path.compare(0, 5, "/api/") == 0 && req.has_header("Origin")) {
            std::string o = req.get_header_value("Origin");
            auto p = o.find("://");
            if (p == std::string::npos ||
                o.substr(p + 3) != req.get_header_value("Host")) {
                sendJson(res, {{"error", "cross-origin request refused"}}, 403);
                return httplib::Server::HandlerResponse::Handled;
            }
        }
        if (!needToken) return httplib::Server::HandlerResponse::Unhandled;
        bool ok =
            req.has_param("token") && req.get_param_value("token") == token;
        if (!ok) {
            auto c = req.get_header_value("Cookie");
            ok = c.find("mart_token=" + token) != std::string::npos;
        }
        if (!ok) {
            sendJson(res, {{"error", "missing or wrong token"}}, 401);
            return httplib::Server::HandlerResponse::Handled;
        }
        if (req.has_param("token"))
            res.set_header("Set-Cookie",
                           "mart_token=" + token +
                               "; Path=/; HttpOnly; SameSite=Strict");
        return httplib::Server::HandlerResponse::Unhandled;
    });

    Editor editor(worker, *session);
    svr.WebSocket("/api/ws",
                  [&](const httplib::Request &, httplib::ws::WebSocket &ws) {
                      auto conn = std::make_shared<Conn>(&ws);
                      editor.attach(conn);
                      std::string msg;
                      for (;;) {
                          auto r = ws.read(msg);
                          if (r == httplib::ws::Fail) break;
                          if (r == httplib::ws::Text) editor.message(conn, msg);
                      }
                      editor.detach(conn);
                  });

    std::unique_ptr<Exporter> exporter;
    try {
        exporter = std::make_unique<Exporter>(
            worker, *session, exportDir, [&](bool b) { editor.setBusy(b); });
    } catch (const std::exception &e) {
        std::fprintf(stderr, "mart: %s\n", e.what());
        return 1;
    }

    // The status must not wait for the engine: during an export it is answered
    // from the last one computed.
    std::mutex statusMutex;
    json lastStatus;
    svr.Get(
        "/api/status", [&](const httplib::Request &, httplib::Response &res) {
            serve(worker, res, [&](Worker &w) {
                json s;
                if (exporter->busy()) {
                    std::lock_guard<std::mutex> g(statusMutex);
                    s = lastStatus.is_object() ? lastStatus : json::object();
                    s["busy"] = "exporting";
                } else {
                    s = w.submit([&] { return session->status(); }).get();
                    std::lock_guard<std::mutex> g(statusMutex);
                    lastStatus = s;
                }
                sendJson(res, s);
            });
        });
    svr.Get("/api/export/formats", [&](const httplib::Request &,
                                       httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            sendJson(res,
                     w.submit([&] { return session->exportFormats(); }).get());
        });
    });
    svr.Post("/api/export",
             [&](const httplib::Request &req, httplib::Response &res) {
                 serve(worker, res, [&](Worker &) {
                     json body = json::parse(req.body.empty() ? "{}" : req.body,
                                             nullptr, false);
                     if (body.is_discarded())
                         throw ApiError(400, "expected a JSON object");
                     sendJson(res, exporter->start(body), 202);
                 });
             });
    svr.Get(R"(/api/export/(\w+)/file)",
            [&](const httplib::Request &req, httplib::Response &res) {
                serve(worker, res, [&](Worker &) {
                    std::string path, name, mime;
                    if (!exporter->file(req.matches[1], path, name, mime))
                        throw ApiError(404, "no such finished export");
                    res.set_header("Content-Disposition",
                                   "attachment; filename=\"" + name + "\"");
                    res.set_header("Cache-Control", "no-store");
                    struct stat st;
                    if (stat(path.c_str(), &st) != 0)
                        throw ApiError(404, "the exported file is gone");
                    res.set_file_content(path, mime);
                });
            });
    svr.Get(R"(/api/export/(\w+))",
            [&](const httplib::Request &req, httplib::Response &res) {
                serve(worker, res, [&](Worker &) {
                    sendJson(res, exporter->status(req.matches[1]));
                });
            });
    svr.Post("/api/open", [&](const httplib::Request &req,
                              httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json body = json::parse(req.body, nullptr, false);
            if (!body.is_object() || !body.contains("path") ||
                !body["path"].is_string())
                throw ApiError(400, "expected {\"path\": \"...\"}");
            std::string p = body["path"];
            const bool discard = body.contains("discard") &&
                                 body["discard"].is_boolean() &&
                                 body["discard"].get<bool>();
            sendJson(res,
                     w.submit([&] { return session->open(p, discard); }).get());
        });
    });
    svr.Get("/api/images", [&](const httplib::Request &req,
                               httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            if (!req.has_param("dir")) throw ApiError(400, "expected ?dir=");
            std::string d = req.get_param_value("dir");
            sendJson(res, w.submit([&] { return session->listImages(d); }).get());
        });
    });
    // a thumbnail of an image of a folder (for the file selector); `v` (the file's mtime)
    // only changes the URL when the file changes, so that the browser can keep it
    svr.Get("/api/thumbnail", [&](const httplib::Request &req,
                                  httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            if (!req.has_param("path")) throw ApiError(400, "expected ?path=");
            const std::string p = req.get_param_value("path");
            const int size = toInt(req, "size", 256);
            std::string jpeg =
                w.submit([&] { return session->thumbnail(p, size); }).get();
            res.set_header("Cache-Control", "private, max-age=86400");
            res.set_content(std::move(jpeg), "image/jpeg");
        });
    });
    svr.Get("/api/info", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            sendJson(res, w.submit([&] { return session->info(); }).get());
        });
    });
    svr.Get("/api/version",
            [&](const httplib::Request &, httplib::Response &res) {
                serve(worker, res, [&](Worker &w) {
                    sendJson(res,
                             w.submit([&] { return session->version(); }).get());
                });
            });
    svr.Get("/api/metadata",
            [&](const httplib::Request &req, httplib::Response &res) {
                serve(worker, res, [&](Worker &w) {
                    const bool mn = req.get_param_value("makernotes") == "1";
                    const bool edits = req.get_param_value("edits") != "0";
                    sendJson(res, w.submit([&] {
                                       return session->metadata(mn, edits);
                                   }).get());
                });
            });
    svr.Post("/api/wb/spot", [&](const httplib::Request &req,
                                 httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            auto num = [&](const char *k) {
                if (!b.is_object() || !b.contains(k) ||
                    !b[k].is_number_integer())
                    throw ApiError(400, "expected x, y, w, h");
                return b[k].get<int>();
            };
            int x = num("x"), y = num("y"), ww = num("w"), hh = num("h");
            sendJson(res, w.submit([&] {
                               return session->spotWB(x, y, ww, hh);
                           }).get());
        });
    });
    svr.Get("/api/profiles",
            [&](const httplib::Request &, httplib::Response &res) {
                serve(worker, res, [&](Worker &w) {
                    sendJson(res, w.submit([&] {
                                       return session->profiles().list();
                                   }).get());
                });
            });
    // import: a profile from a file of the user's is stored in MART's folder
    // (under the name given)
    svr.Post("/api/profiles", [&](const httplib::Request &req,
                                  httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            std::string name = req.get_param_value("name"), text = req.body;
            try {
                sendJson(res,
                         w.submit([&] {
                              return session->profiles().import(name, text);
                          }).get(),
                         201);
            } catch (const ProfileExists &e) {
                throw ApiError(409, e.what());
            } catch (const std::invalid_argument &e) {
                throw ApiError(400, e.what());
            }
        });
    });
    svr.Get("/api/profile-sections",
            [&](const httplib::Request &, httplib::Response &res) {
                serve(worker, res, [&](Worker &w) {
                    sendJson(res, w.submit([&] {
                                       return session->profileSections();
                                   }).get());
                });
            });
    svr.Post("/api/profiles/save", [&](const httplib::Request &req,
                                       httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            if (!b.is_object() || !b.contains("name") ||
                !b["name"].is_string() || !b.contains("sections") ||
                !b["sections"].is_array())
                throw ApiError(400, "expected {name, sections[, overwrite]}");
            std::vector<std::string> ids;
            for (auto &x : b["sections"]) {
                if (!x.is_string())
                    throw ApiError(400, "sections must be strings");
                ids.push_back(x);
            }
            const bool overwrite = b.contains("overwrite") &&
                                   b["overwrite"].is_boolean() &&
                                   b["overwrite"].get<bool>();
            const std::string name = b["name"];
            sendJson(res,
                     w.submit([&] {
                          return session->saveProfile(name, ids, overwrite);
                      }).get(),
                     201);
        });
    });
    // export: the settings of some sections as an .arp file to download (not stored in MART's folder)
    svr.Get("/api/profiles/export", [&](const httplib::Request &req,
                                        httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            std::vector<std::string> ids;
            {
                std::string v = req.get_param_value("sections"), cur;
                for (char c : v + ",") {
                    if (c == ',') {
                        if (!cur.empty()) ids.push_back(cur);
                        cur.clear();
                    } else
                        cur += c;
                }
            }
            if (ids.empty()) throw ApiError(400, "expected sections=a,b,...");
            std::string name = sanitizeStem(req.get_param_value("name"));
            std::string text, stem;
            text = w.submit([&] { return session->profileText(ids, stem); }).get();
            if (name.empty()) name = sanitizeStem(stem);
            if (name.empty()) name = "profile";
            res.set_header("Content-Disposition", "attachment; filename=\"" + name + ".arp\"");
            res.set_header("Cache-Control", "no-store");
            res.set_content(text, "text/plain; charset=utf-8");
        });
    });
    svr.Post("/api/profiles/rename", [&](const httplib::Request &req,
                                         httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            if (!b.is_object() || !b.contains("id") || !b["id"].is_string() ||
                !b.contains("name") || !b["name"].is_string())
                throw ApiError(400, "expected {id, name}");
            const std::string id = b["id"], name = b["name"];
            try {
                sendJson(res, w.submit([&] {
                                   return session->profiles().rename(id, name);
                               }).get());
            } catch (const ProfileExists &e) {
                throw ApiError(409, e.what());
            } catch (const std::out_of_range &e) {
                throw ApiError(404, e.what());
            } catch (const std::invalid_argument &e) {
                throw ApiError(400, e.what());
            }
        });
    });
    svr.Post("/api/profiles/delete", [&](const httplib::Request &req,
                                         httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            if (!b.is_object() || !b.contains("id") || !b["id"].is_string())
                throw ApiError(400, "expected {id}");
            const std::string id = b["id"];
            try {
                w.submit([&] { session->profiles().remove(id); }).get();
            } catch (const std::out_of_range &e) {
                throw ApiError(404, e.what());
            } catch (const std::invalid_argument &e) {
                throw ApiError(400, e.what());
            }
            sendJson(res, w.submit([&] {
                               return session->profiles().list();
                           }).get());
        });
    });
    svr.Post("/api/profiles/default", [&](const httplib::Request &req,
                                          httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            if (!b.is_object() || !b.contains("id") ||
                !(b["id"].is_string() || b["id"].is_null()))
                throw ApiError(400,
                               "expected {id: a profile id, or null for none}");
            const std::string id =
                b["id"].is_null() ? "" : b["id"].get<std::string>();
            try {
                w.submit([&] { session->profiles().setDefault(id); }).get();
            } catch (const std::invalid_argument &e) {
                throw ApiError(400, e.what());
            }
            sendJson(res, w.submit([&] {
                               return session->profiles().list();
                           }).get());
        });
    });
    svr.Get("/api/luts", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            sendJson(res,
                     w.submit([&] { return session->luts().list(); }).get());
        });
    });
    svr.Post(
        "/api/luts", [&](const httplib::Request &req, httplib::Response &res) {
            serve(worker, res, [&](Worker &w) {
                std::string name = req.get_param_value("name");
                try {
                    sendJson(res,
                             w.submit([&] {
                                  return session->luts().import(name, req.body);
                              }).get(),
                             201);
                } catch (const ProfileExists &e) {
                    throw ApiError(409, e.what());
                } catch (const std::invalid_argument &e) {
                    throw ApiError(400, e.what());
                }
            });
        });
    svr.Post("/api/luts/rename", [&](const httplib::Request &req,
                                     httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            if (!b.is_object() || !b.contains("id") || !b["id"].is_string() ||
                !b.contains("name") || !b["name"].is_string())
                throw ApiError(400, "expected {id, name}");
            const std::string id = b["id"], name = b["name"];
            try {
                sendJson(res, w.submit([&] {
                                   return session->luts().rename(id, name);
                               }).get());
            } catch (const ProfileExists &e) {
                throw ApiError(409, e.what());
            } catch (const std::out_of_range &e) {
                throw ApiError(404, e.what());
            } catch (const std::invalid_argument &e) {
                throw ApiError(400, e.what());
            }
        });
    });
    svr.Post("/api/luts/delete", [&](const httplib::Request &req,
                                     httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            if (!b.is_object() || !b.contains("id") || !b["id"].is_string())
                throw ApiError(400, "expected {id}");
            const std::string id = b["id"];
            try {
                w.submit([&] { session->luts().remove(id); }).get();
            } catch (const std::out_of_range &e) {
                throw ApiError(404, e.what());
            }
            sendJson(res,
                     w.submit([&] { return session->luts().list(); }).get());
        });
    });
    svr.Get("/api/lut/params", [&](const httplib::Request &req,
                                   httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            std::string id = req.get_param_value("id");
            sendJson(res,
                     w.submit([&] { return session->lutParams(id); }).get());
        });
    });
    svr.Get("/api/params", [&](const httplib::Request &,
                               httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            sendJson(res, w.submit([&] { return session->params(); }).get());
        });
    });
    svr.Post(
        "/api/save", [&](const httplib::Request &, httplib::Response &res) {
            serve(worker, res, [&](Worker &w) {
                sendJson(res, w.submit([&] { return session->save(); }).get());
            });
        });
    svr.Get("/api/preview", [&](const httplib::Request &req,
                                httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            PreviewRequest pr;
            pr.scale = req.has_param("scale")
                           ? std::atof(req.get_param_value("scale").c_str())
                           : 0;
            pr.out_w = toInt(req, "out_w", 0);
            pr.x = toInt(req, "x", 0);
            pr.y = toInt(req, "y", 0);
            pr.w = toInt(req, "w", 0);
            pr.h = toInt(req, "h", 0);
            PreviewFrame f =
                w.submit([&] { return session->preview(pr); }).get();
            res.set_header("X-Frame-Width", std::to_string(f.width));
            res.set_header("X-Frame-Height", std::to_string(f.height));
            res.set_header("Cache-Control", "no-store");
            res.set_content(std::move(f.jpeg), "image/jpeg");
        });
    });

    // bind first, so that the port is known (and a port that is taken is
    // reported) before the clients are told about the server
    int boundPort = port;
    if (port == 0) {
        boundPort = svr.bind_to_any_port(listen);
        if (boundPort < 0) boundPort = 0;
    } else if (!svr.bind_to_port(listen, port)) {
        boundPort = 0;
    }
    if (boundPort == 0) {
        std::fprintf(stderr, "mart: cannot listen on %s:%d\n", listen.c_str(),
                     port);
        return 1;
    }
    {
        // stop() may come from any thread, at any time after this
        std::lock_guard<std::mutex> g(g_mutex);
        g_addRoot = [&](const std::string &d) { session->addRoot(d); };
        g_stopper = [&] {
            editor.shutdown();
            svr.stop();
        };
    }
    std::printf("MART listening on http://%s:%d/%s\n", listen.c_str(),
                boundPort, needToken ? ("?token=" + token).c_str() : "");
    std::fflush(stdout);
    if (ready) ready(boundPort, token);
    bool stopped;
    {
        std::lock_guard<std::mutex> g(g_mutex);
        stopped = g_stopRequested;
    }
    if (!stopped) svr.listen_after_bind();
    {
        std::lock_guard<std::mutex> g(g_mutex);
        g_stopper = nullptr;
        g_addRoot = nullptr;
        g_finished = true;
    }
    g_cv.notify_all();
    return 0;
}

bool addRoot(const std::string &dir)
{
    std::lock_guard<std::mutex> g(g_mutex);
    if (!g_addRoot) return false;
    g_addRoot(dir);
    return true;
}

void stop()
{
    std::unique_lock<std::mutex> g(g_mutex);
    g_stopRequested = true;
    // the server may not be listening yet, or have just started to: ask again
    // until it has returned
    for (int i = 0; i < 500 && !g_finished && g_stopper; ++i) {
        g_stopper();
        g_cv.wait_for(g, std::chrono::milliseconds(10));
    }
}

}  // namespace mart

extern "C" {

int mart_run(int argc, char **argv, void (*ready)(int, const char *, void *),
             void *user)
{
    return mart::run(argc, argv, [=](int port, const std::string &token) {
        if (ready) ready(port, token.c_str(), user);
    });
}

void mart_stop(void) { mart::stop(); }

int mart_add_root(const char *dir) { return dir && mart::addRoot(dir) ? 0 : -1; }
}
