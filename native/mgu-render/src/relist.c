/* relist.h: an ivi layer onto a screen through a connection made for it. */
#include <errno.h>
#include <string.h>
#include <wayland-client.h>
#include "log.h"
#include "relist.h"
#include "ivi-controller-client-protocol.h"

struct rl {
    struct wl_registry *reg;
    struct ivi_controller *ctl;
    struct wl_output *outputs[16];
    int noutputs;
    struct { uint32_t id; struct ivi_controller_screen *s; } screens[16];
    int nscreens;
};

static void rl_screen(void *d, struct ivi_controller *c, uint32_t id, struct ivi_controller_screen *s) {
    struct rl *r = d;
    (void)c;
    if (r->nscreens < 16) { r->screens[r->nscreens].id = id; r->screens[r->nscreens].s = s; r->nscreens++; }
}
static void rl_id(void *d, struct ivi_controller *c, uint32_t id) { (void)d, (void)c, (void)id; }
static void rl_error(void *d, struct ivi_controller *c, int32_t oid, int32_t ot, int32_t code, const char *t) {
    (void)d, (void)c;
    log_error("relist: ivi error object %d type %d code %d: %s", oid, ot, code, t ? t : "");
}
static const struct ivi_controller_listener rl_listener = { rl_screen, rl_id, rl_id, rl_error };

static void rl_global(void *d, struct wl_registry *reg, uint32_t name, const char *iface, uint32_t ver) {
    struct rl *r = d;
    (void)ver;
    /* winston reports a screen to a controller for each output the connection has bound */
    if (!strcmp(iface, "wl_output") && r->noutputs < 16) r->outputs[r->noutputs++] = wl_registry_bind(reg, name, &wl_output_interface, 1);
    else if (!strcmp(iface, "ivi_controller") && !r->ctl) {
        r->ctl = wl_registry_bind(reg, name, &ivi_controller_interface, 1);
        ivi_controller_add_listener(r->ctl, &rl_listener, r);
    }
}
static void rl_global_remove(void *d, struct wl_registry *reg, uint32_t name) { (void)d, (void)reg, (void)name; }
static const struct wl_registry_listener rl_reg_listener = { rl_global, rl_global_remove };

int relist_put(const char *display, uint32_t screen_id, uint32_t layer_id, int w, int h) {
    struct wl_display *dpy = wl_display_connect(display);
    if (!dpy) { log_error("relist: cannot connect to %s (%s)", display, strerror(errno)); return -1; }
    struct rl r;
    memset(&r, 0, sizeof r);
    r.reg = wl_display_get_registry(dpy);
    wl_registry_add_listener(r.reg, &rl_reg_listener, &r);
    int ok = wl_display_roundtrip(dpy) >= 0 && r.ctl && wl_display_roundtrip(dpy) >= 0;
    /* the configured screen, else the lowest id (the centre display) */
    struct ivi_controller_screen *scr = NULL;
    uint32_t best = 0xffffffffu;
    for (int i = 0; ok && i < r.nscreens; i++) {
        if (screen_id && r.screens[i].id == screen_id) { scr = r.screens[i].s; break; }
        if (r.screens[i].id < best) { best = r.screens[i].id; scr = r.screens[i].s; }
    }
    struct ivi_controller_layer *l = NULL;
    if (scr) {
        l = ivi_controller_layer_create(r.ctl, layer_id, w, h);   /* the existing layer */
        ivi_controller_screen_add_layer(scr, l);
        ivi_controller_commit_changes(r.ctl);
        ok = wl_display_roundtrip(dpy) >= 0;
    } else {
        log_error("relist: %s", ok ? "no screen to put the layer on" : "no ivi controller");
        ok = 0;
    }
    /* the proxies are freed here only (no request): the layer stays, it belongs to the scene, not to this connection */
    if (l) wl_proxy_destroy((struct wl_proxy *)l);
    for (int i = 0; i < r.nscreens; i++) wl_proxy_destroy((struct wl_proxy *)r.screens[i].s);
    for (int i = 0; i < r.noutputs; i++) wl_proxy_destroy((struct wl_proxy *)r.outputs[i]);
    if (r.ctl) wl_proxy_destroy((struct wl_proxy *)r.ctl);
    wl_registry_destroy(r.reg);
    wl_display_disconnect(dpy);
    return ok ? 0 : -1;
}
