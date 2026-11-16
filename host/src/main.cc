// MART host: serves the web UI and drives ART through libART.
// SPDX-License-Identifier: GPL-3.0-or-later
#include "editor.h"
#include "exporter.h"
#include "session.h"
#include "worker.h"
#include "third_party/httplib.h"
#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <mutex>
#include <pthread.h>
#include <random>
#include <thread>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

using namespace mart;

namespace {

void usage()
{
    std::fputs(
        "usage: mart [options] [IMAGE]\n"
        "  --root DIR       directory images may be opened from (repeatable; default: IMAGE's folder)\n"
        "  --listen ADDR    address to bind (default 127.0.0.1; anything else requires the token)\n"
        "  --port N         port (default 8080)\n"
        "  --www DIR        the built client (default: ../client/dist next to the binary)\n"
        "  --socket PATH    use a running `ART-cli --server` instead of the in-process engine\n"
        "  --data DIR       ART's data directory (in-process engine)\n"
        "  --profiles DIR   a folder of .arp profiles to offer (repeatable; default: DATA/profiles and ART's user\n"
        "                   profile folder, if they exist)\n"
        "  --gpu MODE       auto|off|force (in-process engine)\n"
        "  --library PATH   libART (default: $ART_LIBRARY, next to the binary)\n"
        "  --export-dir DIR keep exported files in DIR (default: a temporary folder, for downloading only)\n"
        "  --token TOKEN    access token for non-loopback listening (default: random)\n", stderr);
}

std::string randomToken()
{
    std::random_device rd;
    static const char *hex = "0123456789abcdef";
    std::string t;
    for (int i = 0; i < 24; ++i) t += hex[rd() % 16];
    return t;
}

bool isLoopback(const std::string &a) { return a == "127.0.0.1" || a == "localhost" || a == "::1"; }

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

} // namespace

int main(int argc, char **argv)
{
    // SIGINT and SIGTERM stop the server cleanly (so that the temporary folders are removed): they are blocked in
    // every thread, and one thread waits for them
    sigset_t stopSignals;
    sigemptyset(&stopSignals);
    sigaddset(&stopSignals, SIGINT);
    sigaddset(&stopSignals, SIGTERM);
    pthread_sigmask(SIG_BLOCK, &stopSignals, nullptr);
    EngineOptions eo;
    std::string listen = "127.0.0.1", www, token, image;
    int port = 8080;
    std::vector<std::string> roots;
    std::vector<ProfileDir> profileDirs;
    std::string exportDir;
    bool userProfiles = true;
    bool remote = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto val = [&]() -> std::string {
            if (i + 1 >= argc) { usage(); std::exit(2); }
            return argv[++i];
        };
        if (a == "--root") roots.push_back(val());
        else if (a == "--listen") listen = val();
        else if (a == "--port") port = std::atoi(val().c_str());
        else if (a == "--www") www = val();
        else if (a == "--socket") { eo.socket = val(); remote = true; }
        else if (a == "--data") eo.data_dir = val();
        else if (a == "--export-dir") exportDir = val();
        else if (a == "--profiles") { profileDirs.push_back({"folder", val()}); userProfiles = false; }
        else if (a == "--gpu") eo.gpu = val();
        else if (a == "--library") eo.library = val();
        else if (a == "--token") token = val();
        else if (a == "-h" || a == "--help") { usage(); return 0; }
        else if (a[0] == '-') { usage(); return 2; }
        else image = a;
    }
    eo.inprocess = !remote;
    if (!image.empty() && roots.empty()) {
        char *rp = realpath(image.c_str(), nullptr);
        if (!rp) { std::fprintf(stderr, "mart: no such file: %s\n", image.c_str()); return 1; }
        image = rp;
        free(rp);
        roots.push_back(image.substr(0, image.rfind('/')));
    }
    if (www.empty()) www = exeDir(argv[0]) + "/../client/dist";
    const bool needToken = !isLoopback(listen);
    if (needToken && token.empty()) token = randomToken();

    if (userProfiles) {
        auto add = [&](const char *tag, const std::string &d) {
            struct stat st;
            if (stat(d.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) profileDirs.push_back({tag, d});
        };
        const char *dd = eo.data_dir.empty() ? std::getenv("ART_DATA_DIR") : eo.data_dir.c_str();
        if (dd) add("bundled", std::string(dd) + "/profiles");
        if (const char *home = std::getenv("HOME")) {
            add("user", std::string(home) + "/.config/ART/profiles");
            add("user", std::string(home) + "/Library/Application Support/ART/profiles");
        }
    }

    Worker worker;
    std::unique_ptr<Session> session;
    try {
        worker.submit([&] { session = std::make_unique<Session>(eo, roots, profileDirs); }).get();
        if (!image.empty()) worker.submit([&] { session->open(image); }).get();
    } catch (const std::exception &e) {
        std::fprintf(stderr, "mart: %s\n", e.what());
        return 1;
    }

    httplib::Server svr;
    // only SO_REUSEADDR (to restart at once): with SO_REUSEPORT, which the library sets by default, two copies of
    // MART could share the port and a browser would talk to either of them
    svr.set_socket_options([](socket_t sock) {
        int yes = 1;
        setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char *>(&yes), sizeof(yes));
    });
    svr.set_payload_max_length(2u << 20);
    svr.set_file_extension_and_mimetype_mapping("webmanifest", "application/manifest+json");  // the largest body is an uploaded profile (1 MiB)
    if (!svr.set_mount_point("/", www))
        std::fprintf(stderr, "mart: warning: client directory not found: %s\n", www.c_str());

    svr.set_pre_routing_handler([needToken, token](const httplib::Request &req, httplib::Response &res) {
        // a web page of another origin must not drive the API (CSRF, DNS rebinding)
        if (req.path.compare(0, 5, "/api/") == 0 && req.has_header("Origin")) {
            std::string o = req.get_header_value("Origin");
            auto p = o.find("://");
            if (p == std::string::npos || o.substr(p + 3) != req.get_header_value("Host")) {
                sendJson(res, {{"error", "cross-origin request refused"}}, 403);
                return httplib::Server::HandlerResponse::Handled;
            }
        }
        if (!needToken) return httplib::Server::HandlerResponse::Unhandled;
        bool ok = req.has_param("token") && req.get_param_value("token") == token;
        if (!ok) {
            auto c = req.get_header_value("Cookie");
            ok = c.find("mart_token=" + token) != std::string::npos;
        }
        if (!ok) {
            sendJson(res, {{"error", "missing or wrong token"}}, 401);
            return httplib::Server::HandlerResponse::Handled;
        }
        if (req.has_param("token"))
            res.set_header("Set-Cookie", "mart_token=" + token + "; Path=/; HttpOnly; SameSite=Strict");
        return httplib::Server::HandlerResponse::Unhandled;
    });

    Editor editor(worker, *session);
    svr.WebSocket("/api/ws", [&](const httplib::Request &, httplib::ws::WebSocket &ws) {
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
        exporter = std::make_unique<Exporter>(worker, *session, exportDir, [&](bool b) { editor.setBusy(b); });
    } catch (const std::exception &e) {
        std::fprintf(stderr, "mart: %s\n", e.what());
        return 1;
    }

    // The status must not wait for the engine: during an export it is answered from the last one computed.
    std::mutex statusMutex;
    json lastStatus;
    svr.Get("/api/status", [&](const httplib::Request &, httplib::Response &res) {
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
    svr.Get("/api/export/formats", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) { sendJson(res, w.submit([&] { return session->exportFormats(); }).get()); });
    });
    svr.Post("/api/export", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &) {
            json body = json::parse(req.body.empty() ? "{}" : req.body, nullptr, false);
            if (body.is_discarded()) throw ApiError(400, "expected a JSON object");
            sendJson(res, exporter->start(body), 202);
        });
    });
    svr.Get(R"(/api/export/(\w+)/file)", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &) {
            std::string path, name, mime;
            if (!exporter->file(req.matches[1], path, name, mime)) throw ApiError(404, "no such finished export");
            res.set_header("Content-Disposition", "attachment; filename=\"" + name + "\"");
            res.set_header("Cache-Control", "no-store");
            struct stat st;
            if (stat(path.c_str(), &st) != 0) throw ApiError(404, "the exported file is gone");
            res.set_file_content(path, mime);
        });
    });
    svr.Get(R"(/api/export/(\w+))", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &) { sendJson(res, exporter->status(req.matches[1])); });
    });
    svr.Post("/api/open", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json body = json::parse(req.body, nullptr, false);
            if (!body.is_object() || !body.contains("path") || !body["path"].is_string())
                throw ApiError(400, "expected {\"path\": \"...\"}");
            std::string p = body["path"];
            const bool discard = body.contains("discard") && body["discard"].is_boolean() && body["discard"].get<bool>();
            sendJson(res, w.submit([&] { return session->open(p, discard); }).get());
        });
    });
    svr.Get("/api/info", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) { sendJson(res, w.submit([&] { return session->info(); }).get()); });
    });
    svr.Get("/api/metadata", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            const bool mn = req.get_param_value("makernotes") == "1";
            const bool edits = req.get_param_value("edits") != "0";
            sendJson(res, w.submit([&] { return session->metadata(mn, edits); }).get());
        });
    });
    svr.Post("/api/wb/spot", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            json b = json::parse(req.body, nullptr, false);
            auto num = [&](const char *k) {
                if (!b.is_object() || !b.contains(k) || !b[k].is_number_integer()) throw ApiError(400, "expected x, y, w, h");
                return b[k].get<int>();
            };
            int x = num("x"), y = num("y"), ww = num("w"), hh = num("h");
            sendJson(res, w.submit([&] { return session->spotWB(x, y, ww, hh); }).get());
        });
    });
    svr.Get("/api/profiles", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) { sendJson(res, w.submit([&] { return session->profiles().list(); }).get()); });
    });
    svr.Post("/api/profiles", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            std::string name = req.get_param_value("name"), text = req.body;
            try {
                sendJson(res, w.submit([&] { return session->profiles().upload(name, text); }).get(), 201);
            } catch (const std::invalid_argument &e) {
                throw ApiError(400, e.what());
            }
        });
    });
    svr.Get("/api/params", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) { sendJson(res, w.submit([&] { return session->params(); }).get()); });
    });
    svr.Post("/api/save", [&](const httplib::Request &, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) { sendJson(res, w.submit([&] { return session->save(); }).get()); });
    });
    svr.Get("/api/preview", [&](const httplib::Request &req, httplib::Response &res) {
        serve(worker, res, [&](Worker &w) {
            PreviewRequest pr;
            pr.scale = req.has_param("scale") ? std::atof(req.get_param_value("scale").c_str()) : 0;
            pr.out_w = toInt(req, "out_w", 0);
            pr.x = toInt(req, "x", 0);
            pr.y = toInt(req, "y", 0);
            pr.w = toInt(req, "w", 0);
            pr.h = toInt(req, "h", 0);
            PreviewFrame f = w.submit([&] { return session->preview(pr); }).get();
            res.set_header("X-Frame-Width", std::to_string(f.width));
            res.set_header("X-Frame-Height", std::to_string(f.height));
            res.set_header("Cache-Control", "no-store");
            res.set_content(std::move(f.jpeg), "image/jpeg");
        });
    });

    std::atomic<bool> signalled{false};
    std::thread signalThread([&] {
        int sig = 0;
        sigwait(&stopSignals, &sig);
        signalled = true;
        editor.shutdown();
        svr.stop();
    });
    std::printf("MART listening on http://%s:%d/%s\n", listen.c_str(), port,
                needToken ? ("?token=" + token).c_str() : "");
    std::fflush(stdout);
    const bool listened = svr.listen(listen, port);
    const bool stoppedByUser = signalled;  // before waking the thread ourselves
    if (!stoppedByUser) pthread_kill(signalThread.native_handle(), SIGTERM);
    signalThread.join();
    if (!listened && !stoppedByUser) {
        std::fprintf(stderr, "mart: cannot listen on %s:%d\n", listen.c_str(), port);
        return 1;
    }
    return 0;
}
