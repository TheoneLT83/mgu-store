/*
 * mgu-renderd wire protocol (shared by the daemon and kit/runtime/renderd.js).
 *
 * Stream socket, little endian. Every message: u32 type, u32 payload length, payload.
 * Draw commands are a stream of 32-bit words: an opcode word, then its arguments
 * (f32 coordinates in the app's logical pixels, u32 colours as 0xRRGGBBAA).
 */
#ifndef MGU_PROTO_H
#define MGU_PROTO_H
#include <stdint.h>

#define MGU_PROTO_VERSION 4   /* 2: touch (M_CLAIM / E_TOUCH, MGU7 workspace); 3: pictures (M_IMAGE, OP_IMAGE); 4: video (M_VIDEO, OP_VIDEO) */

/*
 * Video frames (protocol 4): another program (apps/ytplay mgu-ytplay) writes them to a file /dev/shm/mgu-video-<name>;
 * the app names the file (M_VIDEO) and draws OP_VIDEO where the picture goes. The file: struct mgu_video_head, then
 * nslot frames of w*h*3/2 bytes each, I420 (the Y plane, then U, then V, rows without padding). The writer fills
 * slot (slot + 1) % nslot, then sets slot, then seq + 1; the renderer reads seq + slot, then that slot - with 3 slots
 * the writer is two frames away from the one being read. A newer seq redraws the app's last frame by itself.
 */
#define MGU_VIDEO_MAGIC 0x4656474du   /* "MGVF" */
struct mgu_video_head {
    uint32_t magic, version;          /* MGU_VIDEO_MAGIC, 1 */
    uint32_t w, h;                    /* even, 16..2048 */
    uint32_t seq, slot, nslot;        /* frames written so far, the newest one's slot, slots (1..4) */
    uint32_t matrix, full;            /* colours: 0 BT.601 / 1 BT.709; 0 limited (16-235) / 1 full range */
    uint32_t pad[7];                  /* 64 bytes */
};

/* client -> daemon */
enum {
    M_HELLO = 1,      /* utf8 app id */
    M_PLACE = 2,      /* i32 x, y, w, h (screen px), f32 scale, f32 ox, f32 oy: device = logical * scale + (ox, oy) */
    M_SHOW = 3,       /* u32 on */
    M_ATLAS = 4,      /* u32 id, u32 w, u32 h, w*h alpha bytes (padded to 4) */
    M_RAMP = 5,       /* u32 id, u32 n, u32 colour[n] - evenly spaced stops */
    M_LAYER = 6,      /* u32 id, f32 w, f32 h, commands: drawn once into a cached texture */
    M_FRAME = 7,      /* commands: the next frame */
    M_DROP_LAYER = 8, /* u32 id */
    M_CLAIM = 9,      /* u32 n, (f32 x y w h)*n logical px: touch there is this app's while it is shown (n 0 = none) */
    M_IMAGE = 10,     /* u32 id, u32 w, u32 h (1..1024), w*h*4 bytes RGBA premultiplied, rows top-down; same id replaces */
    M_DROP_IMAGE = 11,/* u32 id */
    M_FPS = 12,       /* u32 max frames a second (0 = no cap): faster frames wait, E_TICK comes at that rate (renderd
                         1.1.2; an older renderer ignores it, like any unknown message) */
    M_VIDEO = 13,     /* u32 id, utf8 file path (/dev/shm/mgu-video-*, NUL padded): that video's frames; same id replaces */
    M_DROP_VIDEO = 14,/* u32 id */
};

/* daemon -> client */
enum {
    E_READY = 101,    /* u32 version, u32 screen w, u32 screen h, u32 touch routing on (version 2) */
    E_TICK = 102,     /* u32 frame number, u32 ms since start: the compositor took the last frame, send the next */
    E_ERROR = 103,    /* utf8 text */
    E_STATS = 104,    /* u32 frames shown in the last second, u32 avg render us, u32 max render us */
    E_TOUCH = 105,    /* u32 phase (1 down, 2 move, 3 up), f32 x, f32 y logical px: a gesture that began in a claim */
    E_CLOSED = 106,   /* (none) the HMI was touched outside the claims: the user left the app, it is hidden (SHOW 0) */
};

/* draw opcodes */
enum {
    OP_CLEAR = 1,     /* c */
    OP_RECT = 2,      /* x y w h c */
    OP_GRAD = 3,      /* x y w h n (t c)*n  vertical gradient */
    OP_RRECT = 4,     /* x y w h r c */
    OP_RSTROKE = 5,   /* x y w h r lw c */
    OP_CARD = 6,      /* x y w h r n (t c)*n  rounded rect, vertical gradient */
    OP_RAMPRECT = 7,  /* x y w h r ramp spanX spanW  rounded rect, horizontal colour ramp */
    OP_ARC = 8,       /* cx cy r0 r1 a0 a1 c flags ramp rf rt  (degrees clockwise from 12 o'clock; flags 1 round caps, 2 ramp) */
    OP_LINE = 9,      /* xa ya xb yb width c  round caps */
    OP_TRIS = 10,     /* n (x y c)*3n  plain triangles */
    OP_GLYPHS = 11,   /* atlas c n (x y w h u0 v0 u1 v1)*n  uv in atlas pixels */
    OP_LAYER = 12,    /* id x y */
    OP_CLIP = 13,     /* x y w h */
    OP_NOCLIP = 14,
    OP_QUAD = 15,     /* x0 y0 x1 y1 x2 y2 x3 y3 c  convex quad, anti-aliased edges */
    OP_ALPHA = 16,    /* a  global opacity for what follows (0..1) */
    OP_XF = 17,       /* s ox oy  transform for what follows: device = v * s + (ox, oy); s <= 0: back to the placement's */
    OP_IMAGE = 18,    /* x y w h r id  picture stretched over the rect, corner radius r (layout of OP_RRECT: an older
                         renderer gets OP_RRECT + colour from the kit instead); unknown id: nothing drawn */
    OP_VIDEO = 19,    /* x y w h r id  video id's newest frame fitted into the rect (aspect kept, centred), corner radius r
                         (layout of OP_IMAGE); no frame yet: nothing drawn */
};

#endif
