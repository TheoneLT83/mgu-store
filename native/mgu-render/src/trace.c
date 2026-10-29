#include "trace.h"

#include <stdio.h>
#include <unistd.h>

#include "proto.h"

#define TRACE_MAX (8L << 20)        /* bytes kept; past it the file starts again */

static FILE *f;
static uint64_t looked;

void trace_check(uint64_t now)
{
    if (now - looked < 1000000) return;
    looked = now;
    int want = access(STATS_LOG_FILE, F_OK) == 0;
    if (want && !f) f = fopen(TRACE_FILE, "a");
    else if (!want && f) { fclose(f); f = NULL; }
    if (!f) return;
    fflush(f);
    if (ftell(f) > TRACE_MAX) { fclose(f); f = fopen(TRACE_FILE, "w"); }
}

int trace_on(void) { return f != NULL; }

void trace(uint64_t us, const char *step, const char *app, uint32_t n)
{
    if (f) fprintf(f, "%llu R %s %u %s\n", (unsigned long long)us, step, n, app);
}
