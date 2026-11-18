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

// The live edit channel: a queue of edit operations from the WebSocket client,
// coalesced while the engine is busy, and the frames rendered from it.
#pragma once
#include "session.h"
#include "worker.h"
#include "third_party/httplib.h"
#include <deque>
#include <memory>
#include <mutex>

namespace mart {

// One WebSocket connection. The socket object belongs to the handler thread
// and disappears when the handler returns; detach() must be called then.
class Conn {
public:
    explicit Conn(httplib::ws::WebSocket *ws) : ws_(ws) {}
    bool sendText(const std::string &s);
    bool sendBinary(const std::string &s);
    void close(const std::string &reason);
    void detach();

private:
    std::mutex m_;
    httplib::ws::WebSocket *ws_;
};

struct View {
    bool valid = false;
    int x = 0, y = 0, w = 0,
        h = 0;      // region of the full image (w == 0: all of it)
    int out_w = 0;  // width of the frame, in pixels
};

struct Op {
    enum Type { Edit, Undo, Redo, SetView, Sync, Profile } type = Edit;
    long long seq = 0;
    json patch;
    std::string mergeKey;
    std::string profileId;  // Profile
    bool append = false;    // Profile: add to the image's local-tool regions
                            // instead of replacing them
    View view;
};

class Editor {
public:
    Editor(Worker &w, Session &s) : worker_(w), session_(s) {}

    // the newest connection owns the editor; the previous one is closed
    void attach(const std::shared_ptr<Conn> &c);
    void detach(const std::shared_ptr<Conn> &c);

    // the server is stopping: close the connection (a WebSocket would keep the
    // process alive)
    void shutdown();

    // an export started or ended: the engine is busy, edits wait
    void setBusy(bool exporting);

    // handle one text message of the client (called on its handler thread)
    void message(const std::shared_ptr<Conn> &c, const std::string &text);

private:
    void push(Op op);
    void drain();                            // on the worker
    void sendState(Conn &c, long long seq);  // on the worker
    void sendFrame(Conn &c, long long seq, const View &v);
    static void sendError(Conn &c, long long seq, const std::string &msg,
                          int code = 0);

    Worker &worker_;
    Session &session_;
    std::mutex m_;
    std::shared_ptr<Conn> current_;
    bool exporting_ = false;
    std::deque<Op> q_;
    bool scheduled_ = false;
    View view_;  // worker only: the view to render
};

}  // namespace mart
