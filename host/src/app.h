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

// The MART host as a library: `run` is the whole program (the options of the
// command line, the engine, the server), `stop` ends it from any thread, with
// no signals, so that an app can embed it. See main.cc for the program.
#pragma once
#include <functional>
#include <string>

namespace mart {

/** called when the server is listening: its port and the access token ("" if
 * none) */
using ReadyFn = std::function<void(int port, const std::string &token)>;

/**
 * Run the host with the arguments of the command line (argv[0] is the name of
 * the program); returns when the server has stopped: 0 after a stop(), 1 if
 * it could not start (a message is on stderr). `--port 0` picks a free port,
 * which `ready` tells.
 */
int run(int argc, char **argv, const ReadyFn &ready = {});

/** ask a running `run` to return; any thread. Returns when it has (or soon
 * after). Does nothing if none is running. */
void stop();

}  // namespace mart

// the same for C and Swift
#ifdef __cplusplus
extern "C" {
#endif
int mart_run(int argc, char **argv,
             void (*ready)(int port, const char *token, void *user),
             void *user);
void mart_stop(void);
#ifdef __cplusplus
}
#endif
