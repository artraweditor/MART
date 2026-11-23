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

// JNI shim of the MART host (host/src/app.h) for the Android app: the Kotlin object
// us.pixls.art.MART.Host has run/stop/addRoot.
#include <jni.h>

#include <android/log.h>
#include <string>
#include <vector>

#include "src/app.h"

namespace {

JavaVM *vm = nullptr;

struct Ready {
    jobject callback;  // global ref to us.pixls.art.MART.Host.Ready
    jmethodID method;
};

void ready(int port, const char *token, void *user) {
    auto *r = static_cast<Ready *>(user);
    JNIEnv *env = nullptr;
    bool attached = false;
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
        if (vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
        attached = true;
    }
    jstring t = env->NewStringUTF(token ? token : "");
    env->CallVoidMethod(r->callback, r->method, static_cast<jint>(port), t);
    if (env->ExceptionCheck()) env->ExceptionClear();
    env->DeleteLocalRef(t);
    if (attached) vm->DetachCurrentThread();
}

}  // namespace

extern "C" {

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *v, void *) {
    vm = v;
    return JNI_VERSION_1_6;
}

/** Host.run(args: Array<String>, cb: Host.Ready): Int; returns when the host has stopped */
JNIEXPORT jint JNICALL Java_us_pixls_art_MART_Host_run(JNIEnv *env, jclass, jobjectArray jargs, jobject cb) {
    std::vector<std::string> args;
    const jsize n = env->GetArrayLength(jargs);
    for (jsize i = 0; i < n; ++i) {
        auto s = static_cast<jstring>(env->GetObjectArrayElement(jargs, i));
        const char *c = env->GetStringUTFChars(s, nullptr);
        args.emplace_back(c);
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
    }
    std::vector<char *> argv;
    for (auto &a : args) argv.push_back(a.data());
    argv.push_back(nullptr);

    jclass cls = env->GetObjectClass(cb);
    Ready r{env->NewGlobalRef(cb), env->GetMethodID(cls, "ready", "(ILjava/lang/String;)V")};
    int rc = mart_run(static_cast<int>(args.size()), argv.data(), ready, &r);
    env->DeleteGlobalRef(r.callback);
    __android_log_print(ANDROID_LOG_INFO, "MART", "host stopped (rc=%d)", rc);
    return rc;
}

JNIEXPORT void JNICALL Java_us_pixls_art_MART_Host_stop(JNIEnv *, jclass) { mart_stop(); }

JNIEXPORT jint JNICALL Java_us_pixls_art_MART_Host_addRoot(JNIEnv *env, jclass, jstring dir) {
    const char *c = env->GetStringUTFChars(dir, nullptr);
    int rc = mart_add_root(c);
    env->ReleaseStringUTFChars(dir, c);
    return rc;
}

}  // extern "C"
