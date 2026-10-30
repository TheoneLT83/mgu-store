/*
 * A long-lived ivi_controller client for test/test_relist.sh, driven one command per line on stdin:
 *   layer ID       create (or take) layer ID
 *   add ID         add_layer(screen, ID) on this connection
 *   put ID         relist_put(): ID onto the screen through a connection of its own (src/relist.c)
 *   order ID...    set_render_order(screen, IDs)
 *   destroy ID     destroy layer ID with its scene object
 *   commit         commit_changes
 *   sync           a roundtrip, then "synced"
 * Prints "ev 0x.. screen set|none" when the compositor says a layer of this connection joined or left a screen.
 */
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wayland-client.h>
#include "relist.h"
#include "ivi-controller-client-protocol.h"

static struct wl_display *dpy;
static struct ivi_controller *ctl;
static struct ivi_controller_screen *scr;
static struct { uint32_t id; struct ivi_controller_layer *l; } L[32];
static int nl;

static void c_screen(void *d, struct ivi_controller *c, uint32_t id, struct ivi_controller_screen *s) { (void)d, (void)c, (void)id; scr = s; }
static void c_id(void *d, struct ivi_controller *c, uint32_t id) { (void)d, (void)c, (void)id; }
static void c_error(void *d, struct ivi_controller *c, int32_t o, int32_t t, int32_t e, const char *s) { (void)d, (void)c, (void)o, (void)t, (void)e, (void)s; }
static const struct ivi_controller_listener ctl_l = { c_screen, c_id, c_id, c_error };

static void l_int(void *d, struct ivi_controller_layer *l, int32_t v) { (void)d, (void)l, (void)v; }
static void l_fixed(void *d, struct ivi_controller_layer *l, wl_fixed_t v) { (void)d, (void)l, (void)v; }
static void l_rect(void *d, struct ivi_controller_layer *l, int32_t x, int32_t y, int32_t w, int32_t h) { (void)d, (void)l, (void)x, (void)y, (void)w, (void)h; }
static void l_size(void *d, struct ivi_controller_layer *l, int32_t w, int32_t h) { (void)d, (void)l, (void)w, (void)h; }
static void l_screen(void *d, struct ivi_controller_layer *l, struct wl_output *o) {
    (void)l;
    printf("ev 0x%x screen %s\n", (uint32_t)(uintptr_t)d, o ? "set" : "none");
}
static void l_destroyed(void *d, struct ivi_controller_layer *l) { (void)d, (void)l; }
static const struct ivi_controller_layer_listener layer_l = { l_int, l_fixed, l_rect, l_rect, l_size, l_int, l_screen, l_destroyed };

static void reg(void *d, struct wl_registry *r, uint32_t n, const char *i, uint32_t v) {
    (void)d, (void)v;
    if (!strcmp(i, "wl_output")) wl_registry_bind(r, n, &wl_output_interface, 1);
    else if (!strcmp(i, "ivi_controller")) { ctl = wl_registry_bind(r, n, &ivi_controller_interface, 1); ivi_controller_add_listener(ctl, &ctl_l, NULL); }
}
static void reg_rm(void *d, struct wl_registry *r, uint32_t n) { (void)d, (void)r, (void)n; }
static const struct wl_registry_listener reg_l = { reg, reg_rm };

static struct ivi_controller_layer *layer(uint32_t id) {
    for (int i = 0; i < nl; i++) if (L[i].id == id) return L[i].l;
    struct ivi_controller_layer *l = ivi_controller_layer_create(ctl, id, 1920, 720);
    ivi_controller_layer_add_listener(l, &layer_l, (void *)(uintptr_t)id);
    L[nl].id = id; L[nl].l = l; nl++;
    return l;
}

int main(void) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stdin, NULL, _IONBF, 0);   /* poll() sees every line not read yet */
    dpy = wl_display_connect(NULL);
    if (!dpy) { fprintf(stderr, "no compositor\n"); return 1; }
    wl_registry_add_listener(wl_display_get_registry(dpy), &reg_l, NULL);
    wl_display_roundtrip(dpy);
    wl_display_roundtrip(dpy);
    if (!ctl || !scr) { fprintf(stderr, "no ivi controller or screen\n"); return 1; }
    printf("ready\n");
    char line[256];
    struct pollfd p[2] = { { 0, POLLIN, 0 }, { wl_display_get_fd(dpy), POLLIN, 0 } };
    for (;;) {
        wl_display_flush(dpy);
        if (poll(p, 2, -1) < 0) return 1;
        if ((p[1].revents & POLLIN) && wl_display_dispatch(dpy) < 0) return 1;
        if (!(p[0].revents & (POLLIN | POLLHUP))) continue;
        if (!fgets(line, sizeof line, stdin)) break;
        char *cmd = strtok(line, " \n");
        if (!cmd) continue;
        uint32_t a[16]; int n = 0; char *s;
        while (n < 16 && (s = strtok(NULL, " \n"))) a[n++] = (uint32_t)strtoul(s, NULL, 0);
        if (!strcmp(cmd, "layer") && n) layer(a[0]);
        else if (!strcmp(cmd, "add") && n) ivi_controller_screen_add_layer(scr, layer(a[0]));
        else if (!strcmp(cmd, "put") && n) printf("put %s\n", relist_put(NULL, 0, a[0], 1920, 720) ? "failed" : "ok");
        else if (!strcmp(cmd, "order")) {
            struct wl_array arr;
            wl_array_init(&arr);
            for (int i = 0; i < n; i++) *(uint32_t *)wl_array_add(&arr, 4) = a[i];
            ivi_controller_screen_set_render_order(scr, &arr);
            wl_array_release(&arr);
        } else if (!strcmp(cmd, "destroy") && n) {
            for (int i = 0; i < nl; i++) if (L[i].id == a[0]) { ivi_controller_layer_destroy(L[i].l, 1); L[i] = L[--nl]; break; }
        } else if (!strcmp(cmd, "commit")) ivi_controller_commit_changes(ctl);
        else if (!strcmp(cmd, "sync")) { wl_display_roundtrip(dpy); printf("synced\n"); }
    }
    wl_display_disconnect(dpy);
    return 0;
}
