/* Smoke test of libART's in-process backend on iOS (simulator):
 *   smoke DATA_DIR IMAGE OUT_DIR   -> OUT_DIR/preview.jpg, OUT_DIR/export.jpg */
#include "ART.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int run(ART_engine *e, const char *a0, const char *a1, const char *a2, const char *a3, const char *a4, const char *a5)
{
    const char *argv[8]; int n = 0; ART_result *r = NULL;
    argv[n++] = a0; if (a1) argv[n++] = a1; if (a2) argv[n++] = a2;
    if (a3) argv[n++] = a3; if (a4) argv[n++] = a4; if (a5) argv[n++] = a5;
    argv[n] = NULL;
    int rc = ART_exec_cmd_result(e, argv, &r);
    printf("%s -> rc=%d %s%s\n", a0, rc, r ? ART_result_out(r) : "", r ? ART_result_err(r) : ART_engine_error(e));
    if (r) ART_result_free(r);
    return rc;
}

int main(int argc, char **argv)
{
    if (argc < 4) { fprintf(stderr, "usage: smoke DATA IMAGE OUTDIR\n"); return 2; }
    char cfg[1024], cache[1024], pv[1024], ex[1024];
    snprintf(cfg, sizeof cfg, "%s/config", argv[3]);
    snprintf(cache, sizeof cache, "%s/cache", argv[3]);
    snprintf(pv, sizeof pv, "%s/preview.jpg", argv[3]);
    snprintf(ex, sizeof ex, "%s/export.jpg", argv[3]);
    ART_options *o = ART_options_new();
    ART_options_set_inprocess(o, argv[1], cfg, cache);
    ART_engine *e = ART_engine_create(o);
    if (!e) { fprintf(stderr, "engine: %s\n", ART_options_error(o)); return 1; }
    ART_options_free(o);
    int rc = run(e, "open", argv[2], 0, 0, 0, 0);
    if (!rc) rc = run(e, "preview", pv, "--scale", "0.25", 0, 0);
    if (!rc) rc = run(e, "export", ex, "--quality", "90", "--overwrite", 0);
    ART_engine_destroy(e);
    return rc;
}
