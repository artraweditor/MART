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

// MART host: serves the web UI and drives ART through libART. The program only
// stops the host on SIGINT and SIGTERM (so that its temporary folders are
// removed); everything else is in app.cc.
#include "app.h"
#include <csignal>
#include <pthread.h>
#include <thread>

int main(int argc, char **argv)
{
    // the signals are blocked in every thread, and one thread waits for them
    sigset_t stopSignals;
    sigemptyset(&stopSignals);
    sigaddset(&stopSignals, SIGINT);
    sigaddset(&stopSignals, SIGTERM);
    pthread_sigmask(SIG_BLOCK, &stopSignals, nullptr);
    std::thread signalThread([&] {
        int sig = 0;
        sigwait(&stopSignals, &sig);
        mart::stop();
    });
    const int rc = mart::run(argc, argv);
    // wake the thread if the server ended by itself
    pthread_kill(signalThread.native_handle(), SIGTERM);
    signalThread.join();
    return rc;
}
