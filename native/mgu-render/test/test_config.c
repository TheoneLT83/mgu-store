/* The fps settings: the global one, an app's own (fps.<app>), and values refused. */
#include <stdio.h>
#include <string.h>

#include "config.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("FAIL "); printf(__VA_ARGS__); printf("\n"); } } while (0)

int main(void)
{
    struct cfg c;
    cfg_defaults(&c);
    CHECK(cfg_fps(&c, "robertn_store") == 0, "the default: each app its own rate");
    CHECK(cfg_set_pair(&c, "fps.robertn_store = 60") == 0 && cfg_fps(&c, "robertn_store") == 60, "an app's own");
    CHECK(cfg_fps(&c, "doom") == 0, "the others keep theirs");
    CHECK(cfg_set_pair(&c, "fps=30") == 0 && cfg_fps(&c, "doom") == 30 && cfg_fps(&c, "robertn_store") == 60, "the global one, an app's own over it");
    CHECK(cfg_set_pair(&c, "fps.robertn_store=30") == 0 && cfg_fps(&c, "robertn_store") == 30 && c.n_app_fps == 1, "set again, not added");
    CHECK(cfg_set_pair(&c, "fps=2000") < 0 && cfg_set_pair(&c, "fps.x=-1") < 0 && cfg_set_pair(&c, "fps.=60") < 0, "out of range refused");
    for (int i = 0; i < CFG_MAX_APP_FPS; i++) {
        char kv[32];
        snprintf(kv, sizeof kv, "fps.app%d=60", i);
        cfg_set_pair(&c, kv);
    }
    CHECK(c.n_app_fps == CFG_MAX_APP_FPS, "at most %d apps", CFG_MAX_APP_FPS);
    printf("test_config: %d checks, %d failed\n", checks, fails);
    return fails != 0;
}
