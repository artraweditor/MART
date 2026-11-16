// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <condition_variable>
#include <deque>
#include <functional>
#include <future>
#include <mutex>
#include <thread>

namespace mart {

// One thread that runs jobs in order. The engine lives here: libART calls
// block and cannot be interrupted, so every call goes through this queue.
class Worker {
public:
    Worker(): th_([this] { loop(); }) {}
    ~Worker()
    {
        {
            std::lock_guard<std::mutex> g(m_);
            stop_ = true;
        }
        cv_.notify_all();
        th_.join();
    }
    template <class F> auto submit(F f) -> std::future<decltype(f())>
    {
        using R = decltype(f());
        auto task = std::make_shared<std::packaged_task<R()>>(std::move(f));
        auto fut = task->get_future();
        {
            std::lock_guard<std::mutex> g(m_);
            q_.push_back([task] { (*task)(); });
        }
        cv_.notify_one();
        return fut;
    }
private:
    void loop()
    {
        for (;;) {
            std::function<void()> job;
            {
                std::unique_lock<std::mutex> l(m_);
                cv_.wait(l, [this] { return stop_ || !q_.empty(); });
                if (q_.empty()) return;
                job = std::move(q_.front());
                q_.pop_front();
            }
            job();
        }
    }
    std::mutex m_;
    std::condition_variable cv_;
    std::deque<std::function<void()>> q_;
    bool stop_ = false;
    std::thread th_;  // last: starts after the other members exist
};

} // namespace mart
