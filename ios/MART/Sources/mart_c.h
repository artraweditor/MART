// The C entry points of the MART host (host/src/app.h), for Swift.
#ifndef MART_C_H
#define MART_C_H
#ifdef __cplusplus
extern "C" {
#endif
int mart_run(int argc, char **argv, void (*ready)(int port, const char *token, void *user), void *user);
void mart_stop(void);
int mart_add_root(const char *dir);
#ifdef __cplusplus
}
#endif
#endif
