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

#include "editor.h"
#include <chrono>

namespace mart {

bool Conn::sendText(const std::string &s)
{
    std::lock_guard<std::mutex> g(m_);
    return ws_ && ws_->send(s);
}

bool Conn::sendBinary(const std::string &s)
{
    std::lock_guard<std::mutex> g(m_);
    return ws_ && ws_->send(s.data(), s.size());
}

void Conn::close(const std::string &reason)
{
    std::lock_guard<std::mutex> g(m_);
    if (ws_) ws_->close(httplib::ws::CloseStatus::Normal, reason);
}

void Conn::detach()
{
    std::lock_guard<std::mutex> g(m_);
    ws_ = nullptr;
}

void Editor::attach(const std::shared_ptr<Conn> &c)
{
    std::shared_ptr<Conn> old;
    bool exporting = false;
    {
        std::lock_guard<std::mutex> g(m_);
        old = current_;
        current_ = c;
        q_.clear();
        exporting = exporting_;
    }
    if (exporting)
        c->sendText(json{{"type", "busy"}, {"what", "exporting"}}.dump());
    if (old) {
        old->sendText(json{{"type", "replaced"}}.dump());
        old->close("replaced by a newer connection");
    }
}

void Editor::shutdown()
{
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(m_);
        c = std::move(current_);
        q_.clear();
    }
    if (c) c->close("the server is stopping");
}

void Editor::setBusy(bool exporting)
{
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(m_);
        exporting_ = exporting;
        c = current_;
    }
    if (c)
        c->sendText(
            json{{"type", "busy"},
                 {"what", exporting ? json("exporting") : json(nullptr)}}
                .dump());
}

void Editor::detach(const std::shared_ptr<Conn> &c)
{
    std::lock_guard<std::mutex> g(m_);
    if (current_ == c) current_.reset();
    c->detach();
}

namespace {

bool parseView(const json &j, View &v)
{
    if (!j.is_object()) return false;
    auto num = [&](const char *k, int lo, int hi, int &out) {
        if (!j.contains(k)) return true;
        if (!j[k].is_number()) return false;
        double d = j[k].get<double>();
        if (!(d >= lo && d <= hi)) return false;
        out = static_cast<int>(d);
        return true;
    };
    View n;
    if (!num("x", 0, 1000000, n.x) || !num("y", 0, 1000000, n.y) ||
        !num("w", 0, 1000000, n.w) || !num("h", 0, 1000000, n.h) ||
        !num("out_w", 1, 4096, n.out_w))
        return false;
    if (n.out_w <= 0 || (n.w > 0) != (n.h > 0)) return false;
    n.valid = true;
    v = n;
    return true;
}

}  // namespace

void Editor::message(const std::shared_ptr<Conn> &c, const std::string &text)
{
    json m = json::parse(text, nullptr, false);
    auto fail = [&](long long seq, const std::string &why) {
        sendError(*c, seq, why);
    };
    if (!m.is_object() || !m.contains("type") || !m["type"].is_string()) {
        fail(0, "bad message");
        return;
    }
    const std::string type = m["type"];
    const long long seq = m.contains("seq") && m["seq"].is_number_integer()
                              ? m["seq"].get<long long>()
                              : 0;
    {
        std::lock_guard<std::mutex> g(m_);
        if (current_ != c) return;  // replaced
    }
    if (type == "ping") {
        c->sendText(json{{"type", "pong"}, {"seq", seq}}.dump());
        return;
    }
    Op op;
    op.seq = seq;
    if (m.contains("view") && !parseView(m["view"], op.view)) {
        fail(seq, "bad view");
        return;
    }
    if (type == "edit") {
        op.type = Op::Edit;
        if (!m.contains("patch") || !m["patch"].is_object()) {
            fail(seq, "edit needs a patch");
            return;
        }
        op.patch = m["patch"];
        if (m.contains("merge")) {
            if (!m["merge"].is_string() ||
                m["merge"].get<std::string>().size() > 64) {
                fail(seq, "bad merge key");
                return;
            }
            op.mergeKey = m["merge"];
        }
    } else if (type == "view") {
        if (!op.view.valid) {
            fail(seq, "view needs a view");
            return;
        }
        op.type = Op::SetView;
    } else if (type == "undo") {
        op.type = Op::Undo;
    } else if (type == "redo") {
        op.type = Op::Redo;
    } else if (type == "profile") {
        op.type = Op::Profile;
        if (!m.contains("id") || !m["id"].is_string()) {
            fail(seq, "profile needs an id");
            return;
        }
        op.profileId = m["id"];
        op.append = m.contains("append") && m["append"].is_boolean() &&
                    m["append"].get<bool>();
    } else if (type == "sync") {
        op.type = Op::Sync;
    } else {
        fail(seq, "unknown message type: " + type);
        return;
    }
    push(std::move(op));
}

void Editor::push(Op op)
{
    bool schedule = false;
    {
        std::lock_guard<std::mutex> g(m_);
        Op *b = q_.empty() ? nullptr : &q_.back();
        if (b && op.type == Op::Edit && b->type == Op::Edit &&
            !op.mergeKey.empty() && b->mergeKey == op.mergeKey) {
            // the same gesture: keep one apply with the newest value of each
            // key
            for (auto &[grp, keys] : op.patch.items())
                for (auto &[k, v] : keys.items()) b->patch[grp][k] = v;
            b->seq = op.seq;
            if (op.view.valid) b->view = op.view;
        } else if (b && op.type == Op::SetView && b->type == Op::SetView) {
            *b = std::move(op);
        } else {
            q_.push_back(std::move(op));
            if (!scheduled_) scheduled_ = schedule = true;
        }
    }
    if (schedule) worker_.submit([this] { drain(); });
}

void Editor::sendError(Conn &c, long long seq, const std::string &msg, int code)
{
    json j = {{"type", "error"}, {"seq", seq}, {"message", msg}};
    if (code) j["code"] = code;
    c.sendText(j.dump());
}

void Editor::sendState(Conn &c, long long seq)
{
    json p = session_.params();
    json s = {{"type", "state"},
              {"seq", seq},
              {"params", p["params"]},
              {"history", session_.history()},
              {"dirty", session_.dirty()},
              {"size",
               {{"full_width", session_.fullWidth()},
                {"full_height", session_.fullHeight()}}}};
    c.sendText(s.dump());
}

void Editor::sendFrame(Conn &c, long long seq, const View &v)
{
    using clock = std::chrono::steady_clock;
    auto t0 = clock::now();
    PreviewRequest pr;
    pr.x = v.x;
    pr.y = v.y;
    pr.w = v.w;
    pr.h = v.h;
    pr.out_w = v.out_w;
    PreviewFrame f = session_.preview(pr);
    long long ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(clock::now() - t0)
            .count();
    json region = {{"x", f.x}, {"y", f.y}, {"w", f.w}, {"h", f.h}};
    json hdr = {{"type", "frame"},
                {"seq", seq},
                {"region", region},
                {"w", f.width},
                {"h", f.height},
                {"ms", ms},
                {"history", session_.history()},
                {"dirty", session_.dirty()},
                {"size",
                 {{"full_width", session_.fullWidth()},
                  {"full_height", session_.fullHeight()}}}};
    std::string h = hdr.dump();
    std::string msg;
    msg.reserve(4 + h.size() + f.jpeg.size());
    uint32_t n = static_cast<uint32_t>(h.size());
    msg.push_back(char(n >> 24));
    msg.push_back(char(n >> 16));
    msg.push_back(char(n >> 8));
    msg.push_back(char(n));
    msg += h;
    msg += f.jpeg;
    c.sendBinary(msg);
}

void Editor::drain()
{
    // what is owed to the client once the queue is empty: only the last state
    // and frame are worth sending
    bool needState = false, needRender = false;
    long long lastSeq = 0;
    for (;;) {
        Op op;
        std::shared_ptr<Conn> c;
        bool last;
        {
            std::lock_guard<std::mutex> g(m_);
            if (q_.empty()) {
                scheduled_ = false;
                return;
            }
            op = std::move(q_.front());
            q_.pop_front();
            last = q_.empty();
            c = current_;
        }
        if (!c) {
            needState = needRender = false;
            continue;
        }
        try {
            if (op.view.valid) view_ = op.view;
            lastSeq = op.seq;
            switch (op.type) {
            case Op::Edit:
                session_.applyPatch(op.patch, op.mergeKey);
                needRender = true;
                break;
            case Op::Undo:
                session_.undo();
                needRender = needState = true;
                break;
            case Op::Redo:
                session_.redo();
                needRender = needState = true;
                break;
            case Op::SetView:
                needRender = true;
                break;
            case Op::Profile:
                session_.applyProfile(op.profileId, op.append);
                needRender = needState = true;
                break;
            case Op::Sync:
                needRender = needState = true;
                break;
            }
        } catch (const ApiError &e) {
            sendError(*c, op.seq, e.what());
        } catch (const ArtError &e) {
            sendError(*c, op.seq, e.what(), e.code);
        } catch (const std::exception &e) {
            sendError(*c, op.seq, e.what());
        }
        if (!last) continue;
        try {
            if (needState && session_.isOpen()) sendState(*c, lastSeq);
            if (needRender && view_.valid && session_.isOpen())
                sendFrame(*c, lastSeq, view_);
        } catch (const ApiError &e) {
            sendError(*c, lastSeq, e.what());
        } catch (const ArtError &e) {
            sendError(*c, lastSeq, e.what(), e.code);
        } catch (const std::exception &e) {
            sendError(*c, lastSeq, e.what());
        }
        needState = needRender = false;
    }
}

}  // namespace mart
