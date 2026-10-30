/*
 * A stand-in for Winston's ivi_controller (wayland-0), for test/test_relist.sh: one screen (id 4) on one wl_output,
 * layers by id, and the screen's layer list as Winston keeps it. Each connection has its own copy of the list, taken
 * when it binds ivi_controller and changed only by its own add_layer and set_render_order; its commit makes that copy
 * the screen's list. So a connection open a while drops the layers others put on the screen since (as measured on
 * the head unit). A layer's owner hears it leave or join the list (ivi_controller_layer.screen). A layer destroyed
 * with destroy_scene_object leaves the list alone, keeping the rest.
 *   mock_winston SOCKET
 * Prints "order 0x.. 0x.." each time the screen's list changes.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wayland-server.h>

#include "ivi-controller-server-protocol.h"

#define MAXL 64
#define SCREEN_ID 4

struct conn {
    struct wl_list link;
    struct wl_listener gone;
    struct wl_client *client;
    struct wl_resource *output, *ctl;
    uint32_t view[MAXL]; int nview;
    int dirty;
};
struct layer { uint32_t id; int alive; struct wl_list res; };   /* res: each connection's ivi_controller_layer */

static struct wl_display *dpy;
static struct wl_list conns;
static struct layer layers[MAXL]; static int nlayers;
static uint32_t order[MAXL]; static int norder;

static void client_gone(struct wl_listener *l, void *d) {
    (void)d;
    struct conn *k = wl_container_of(l, k, gone);
    wl_list_remove(&k->link);
    free(k);
}
static struct conn *conn_of(struct wl_client *c) {
    struct conn *k;
    wl_list_for_each(k, &conns, link) if (k->client == c) return k;
    k = calloc(1, sizeof *k);
    k->client = c;
    k->gone.notify = client_gone;
    wl_client_add_destroy_listener(c, &k->gone);
    wl_list_insert(&conns, &k->link);
    return k;
}
static struct layer *layer_of(uint32_t id) {
    for (int i = 0; i < nlayers; i++) if (layers[i].id == id && layers[i].alive) return &layers[i];
    return NULL;
}
static int in(const uint32_t *a, int n, uint32_t id) { for (int i = 0; i < n; i++) if (a[i] == id) return 1; return 0; }

static void tell(uint32_t id, int on) {   /* every connection's proxy of the layer hears where it is */
    struct layer *l = layer_of(id);
    if (!l) return;
    struct wl_resource *r;
    wl_resource_for_each(r, &l->res) {
        struct conn *k = conn_of(wl_resource_get_client(r));
        if (on && !k->output) continue;
        ivi_controller_layer_send_screen(r, on ? k->output : NULL);
    }
}
static void set_order(const uint32_t *ids, int n) {
    uint32_t old[MAXL]; int nold = norder;
    memcpy(old, order, sizeof order);
    norder = 0;
    for (int i = 0; i < n; i++) if (layer_of(ids[i]) && !in(order, norder, ids[i])) order[norder++] = ids[i];
    if (norder == nold && !memcmp(old, order, sizeof(uint32_t) * norder)) return;
    for (int i = 0; i < nold; i++) if (!in(order, norder, old[i])) tell(old[i], 0);
    for (int i = 0; i < norder; i++) if (!in(old, nold, order[i])) tell(order[i], 1);
    printf("order");
    for (int i = 0; i < norder; i++) printf(" 0x%x", order[i]);
    printf("\n");
    fflush(stdout);
}

/* ivi_controller_layer: only destroy matters */
static void l_destroy(struct wl_client *c, struct wl_resource *r, int32_t scene) {
    (void)c;
    struct layer *l = wl_resource_get_user_data(r);
    if (scene && l && l->alive) {
        uint32_t rest[MAXL]; int n = 0;
        for (int i = 0; i < norder; i++) if (order[i] != l->id) rest[n++] = order[i];
        l->alive = 0;
        set_order(rest, n);
    }
    wl_resource_destroy(r);
}
static void l_uint(struct wl_client *c, struct wl_resource *r, uint32_t v) { (void)c, (void)r, (void)v; }
static void l_fixed(struct wl_client *c, struct wl_resource *r, wl_fixed_t v) { (void)c, (void)r, (void)v; }
static void l_int(struct wl_client *c, struct wl_resource *r, int32_t v) { (void)c, (void)r, (void)v; }
static void l_rect(struct wl_client *c, struct wl_resource *r, int32_t x, int32_t y, int32_t w, int32_t h) { (void)c, (void)r, (void)x, (void)y, (void)w, (void)h; }
static void l_size(struct wl_client *c, struct wl_resource *r, int32_t w, int32_t h) { (void)c, (void)r, (void)w, (void)h; }
static void l_str(struct wl_client *c, struct wl_resource *r, const char *s) { (void)c, (void)r, (void)s; }
static void l_none(struct wl_client *c, struct wl_resource *r) { (void)c, (void)r; }
static void l_obj(struct wl_client *c, struct wl_resource *r, struct wl_resource *o) { (void)c, (void)r, (void)o; }
static void l_arr(struct wl_client *c, struct wl_resource *r, struct wl_array *a) { (void)c, (void)r, (void)a; }
static const struct ivi_controller_layer_interface layer_impl = {
    l_uint, l_fixed, l_rect, l_rect, l_size, l_int, l_str, l_none, l_obj, l_obj, l_arr, l_destroy,
};
static void layer_res_gone(struct wl_resource *r) { wl_list_remove(wl_resource_get_link(r)); }

/* ivi_controller_screen: the connection's own copy of the list */
static void s_destroy(struct wl_client *c, struct wl_resource *r) { (void)c; wl_resource_destroy(r); }
static void s_clear(struct wl_client *c, struct wl_resource *r) { (void)r; struct conn *k = conn_of(c); k->nview = 0; k->dirty = 1; }
static void s_add(struct wl_client *c, struct wl_resource *r, struct wl_resource *lr) {
    (void)r;
    struct conn *k = conn_of(c);
    struct layer *l = wl_resource_get_user_data(lr);
    if (!l) return;
    int n = 0;
    for (int i = 0; i < k->nview; i++) if (k->view[i] != l->id) k->view[n++] = k->view[i];
    k->view[n++] = l->id;
    k->nview = n; k->dirty = 1;
}
static void s_shot(struct wl_client *c, struct wl_resource *r, const char *f) { (void)c, (void)r, (void)f; }
static void s_order(struct wl_client *c, struct wl_resource *r, struct wl_array *a) {
    (void)r;
    struct conn *k = conn_of(c);
    uint32_t *id;
    k->nview = 0;
    wl_array_for_each(id, a) if (k->nview < MAXL) k->view[k->nview++] = *id;
    k->dirty = 1;
}
static const struct ivi_controller_screen_interface screen_impl = { s_destroy, s_clear, s_add, s_shot, s_order };

/* ivi_controller */
static void c_commit(struct wl_client *c, struct wl_resource *r) {
    (void)r;
    struct conn *k = conn_of(c);
    if (!k->dirty) return;
    k->dirty = 0;
    set_order(k->view, k->nview);
}
static void c_layer_create(struct wl_client *c, struct wl_resource *r, uint32_t id, int32_t w, int32_t h, uint32_t nid) {
    (void)w, (void)h;
    struct layer *l = layer_of(id);
    if (!l && nlayers < MAXL) {
        l = &layers[nlayers++];
        l->id = id; l->alive = 1;
        wl_list_init(&l->res);
    }
    struct wl_resource *lr = wl_resource_create(c, &ivi_controller_layer_interface, 1, nid);
    wl_resource_set_implementation(lr, &layer_impl, l, layer_res_gone);
    if (l) wl_list_insert(&l->res, wl_resource_get_link(lr));
    (void)r;
}
static void c_surface_create(struct wl_client *c, struct wl_resource *r, uint32_t id, uint32_t nid) {
    (void)r, (void)id;
    struct wl_resource *sr = wl_resource_create(c, &ivi_controller_surface_interface, 1, nid);
    wl_resource_set_implementation(sr, NULL, NULL, NULL);
}
static const struct ivi_controller_interface ctl_impl = { c_commit, c_layer_create, c_surface_create };

static void announce(struct conn *k) {   /* a screen for a controller once the connection has the output */
    if (!k->ctl || !k->output) return;
    struct wl_resource *s = wl_resource_create(k->client, &ivi_controller_screen_interface, 1, 0);
    wl_resource_set_implementation(s, &screen_impl, NULL, NULL);
    ivi_controller_send_screen(k->ctl, SCREEN_ID, s);
    for (int i = 0; i < nlayers; i++) if (layers[i].alive) ivi_controller_send_layer(k->ctl, layers[i].id);
}
static void conn_gone(struct wl_resource *r) {
    struct conn *k = conn_of(wl_resource_get_client(r));
    if (k->ctl == r) k->ctl = NULL;
    if (k->output == r) k->output = NULL;
}
static void bind_ctl(struct wl_client *c, void *d, uint32_t v, uint32_t id) {
    (void)d;
    struct conn *k = conn_of(c);
    k->ctl = wl_resource_create(c, &ivi_controller_interface, v, id);
    wl_resource_set_implementation(k->ctl, &ctl_impl, NULL, conn_gone);
    memcpy(k->view, order, sizeof order);   /* the list as it is now */
    k->nview = norder;
    announce(k);
}
static void o_release(struct wl_client *c, struct wl_resource *r) { (void)c; wl_resource_destroy(r); }
static const struct wl_output_interface output_impl = { o_release };
static void bind_output(struct wl_client *c, void *d, uint32_t v, uint32_t id) {
    (void)d;
    struct conn *k = conn_of(c);
    struct wl_resource *o = wl_resource_create(c, &wl_output_interface, v, id);
    wl_resource_set_implementation(o, &output_impl, NULL, conn_gone);
    if (!k->output) { k->output = o; announce(k); }
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: mock_winston SOCKET\n"); return 2; }
    wl_list_init(&conns);
    dpy = wl_display_create();
    if (wl_display_add_socket(dpy, argv[1])) { perror("socket"); return 1; }
    wl_global_create(dpy, &wl_output_interface, 2, NULL, bind_output);
    wl_global_create(dpy, &ivi_controller_interface, 1, NULL, bind_ctl);
    printf("ready\n");
    fflush(stdout);
    wl_display_run(dpy);
    return 0;
}
