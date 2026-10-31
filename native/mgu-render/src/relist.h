#pragma once
#include <stdint.h>

/* Puts an existing ivi layer on top of a screen's layers through a connection of its own, made for this and closed
 * again. Winston applies a screen's add_layer to the layer list as the calling connection last saw or set it: a
 * connection that has been open a while drops every layer other programs put on the screen since. A new connection
 * sees the list as it is, so the other programs' layers stay.
 *   display: the compositor's socket name (wayland-0); screen_id: 0 for the lowest id (the centre display);
 *   w, h: the layer's size (a layer of this id exists already; winston takes the id).
 * Returns 0 once the compositor has taken it, -1 otherwise (logged). */
int relist_put(const char *display, uint32_t screen_id, uint32_t layer_id, int w, int h);
