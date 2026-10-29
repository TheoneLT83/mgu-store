/*
 * Per-frame trace (tools/car-test/trace.js), while the stats-log switch exists: one line per step,
 * "<us> R <step> <n> <app>" in TRACE_FILE, <us> CLOCK_MONOTONIC (as Node's process.hrtime on the same unit),
 * <n> the app's frame or touch count on this connection (the app counts the same way).
 */
#ifndef MGU_TRACE_H
#define MGU_TRACE_H
#include <stdint.h>

#define TRACE_FILE "/run/mgu-render/trace.log"

void trace_check(uint64_t now_us);          /* every loop turn: on while the stats-log switch exists (looked at once a second) */
void trace(uint64_t us, const char *step, const char *app, uint32_t n);
int trace_on(void);

#endif
