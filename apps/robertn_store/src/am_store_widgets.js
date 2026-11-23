'use strict';
/*
 * The store's widgets (App Manager 2) for renderer screens: app icons, app grid, lists with pictures, chips, side
 * menu, buttons, on-screen keyboard, sheet. Every icon here is drawn by the renderer - kit/vicons.js vector icons or
 * pictures an app hands over (ScreenApp.setImage -> 'key:<name>') - never the HMI's glyph icons, which differ between
 * iDrive 7 and 8 (widgets.js icon()). Same signature as widgets.js: (cv, t, b, o).
 * Taps reach the app as ScreenApp 'change' events: o.tap = { id, part, n } / o.key = { text, n }, n counting up so a
 * second tap on the same thing is a change too.
 */
const { withAlpha, mix } = require('./kit_canvas.js');
const { vicon } = require('./kit_vicons.js');
const W = require('./am_widgets.js');
const { t: tr } = require('./i18n.js');

const GREEN = '#35d07f', BLUE = '#3d9bff', AMBER = '#ffb020';
const C = (t, c, d) => (c ? t[c] || c : d);
const mid = (cv, s, x, cy, size, c, opts) => cv.text(String(s), x, cy + size * 0.36, size, c, opts);
const lines = (s) => String(s || '').split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((l) => l[0]);
const pair = (s, d) => { const p = String(s || '').split(',').map((x) => x.trim()).filter(Boolean); return p.length >= 2 ? p : d; };
const tapped = (o, id, part) => { o.tapN = (o.tapN || 0) + 1; o.tap = { id, part, n: o.tapN }; };
const BADGE = { installed: [GREEN, 'check'], update: [BLUE, 'arrowDown'], queued: [AMBER, 'clock'] };

/**
 * App icon in the s x s square at (x, y): the picture a.icon names, else a gradient (a.colors) with the vector glyph
 * a.vicon, else the title's first letter. Apps: rounded square; system services (a.kind 'service' or a service kind):
 * round. a.badge: installed | update | queued; a.progress 0..1: a ring (downloading). bg: the colour behind the badge.
 */
function appIcon(cv, t, a, x, y, s, bg) {
    const cx = x + s / 2, cy = y + s / 2, round = a.kind && a.kind !== 'app', c = pair(a.colors, ['#3a4352', '#232a35']);
    const img = a.icon ? W.picture(a.icon) : null;
    if (img) cv.image(img, x, y, s, s, round ? s / 2 : s * 0.24);
    else if (round) {
        cv.circle(cx, cy, s / 2, c[1]); cv.circle(cx, cy, s / 2 - s * 0.06, c[0]); cv.circle(cx, cy, s / 2 - s * 0.12, withAlpha(c[1], 0.55));
    } else {
        cv.card(x, y, s, s, s * 0.24, [[0, c[0]], [1, c[1]]]);
        cv.card(x, y, s, s * 0.5, s * 0.24, [[0, withAlpha('#ffffff', 0.18)], [1, withAlpha('#ffffff', 0)]]);
    }
    if (!img) {
        const g = s * 0.56;
        if (!(a.vicon && vicon(cv, a.vicon, cx - g / 2, cy - g / 2, g, '#ffffff'))) {
            const letter = String(a.letter || a.title || '?').trim()[0] || '?';
            cv.text(letter.toUpperCase(), cx, cy + s * 0.18, Math.round(s * 0.5), '#ffffff', { align: 'center', font: 'bold' });
        }
    }
    if (typeof a.progress === 'number' && a.progress >= 0) {
        const r0 = s / 2 + s * 0.06, r1 = s / 2 + s * 0.1;
        cv.arc(cx, cy, r0, r1, 0, 360, withAlpha('#ffffff', 0.15));
        if (a.progress > 0) cv.arc(cx, cy, r0, r1, 0, 360 * Math.min(1, a.progress), BLUE);
    }
    const bd = BADGE[a.badge];
    if (bd) {
        const br = s * 0.17, bx = x + s - br * 0.6, by = y + br * 0.6, gs = br * 1.3;
        cv.circle(bx, by, br + Math.max(2, s * 0.03), bg || t.bg);
        cv.circle(bx, by, br, bd[0]);
        vicon(cv, bd[1], bx - gs / 2, by - gs / 2, gs, '#ffffff');
    }
}

/** Pill with optional dot; returns its width. x = right edge when right. */
function chip(cv, text, x, y, h, c, dot, right) {
    const s = Math.round(h * 0.44), d = h * 0.16, w = cv.textWidth(text, s) + h * 0.9 + (dot ? d * 3 : 0), x0 = right ? x - w : x;
    cv.roundRect(x0, y, w, h, h / 2, withAlpha(c, 0.14));
    cv.strokeRoundRect(x0, y, w, h, h / 2, 2, withAlpha(c, 0.55));
    let tx = x0 + h * 0.45;
    if (dot) { cv.circle(tx + d, y + h / 2, d, c); tx += d * 3; }
    cv.text(text, tx, y + h / 2 + s * 0.36, s, c);
    return w;
}
const chipItems = (items) => (Array.isArray(items) ? items
    : String(items || '').split(';').map((s) => s.split('|').map((x) => x.trim())).filter((p) => p[0])
        .map((p) => ({ text: p[0], color: p[1], dot: p[2] === 'dot' })));

/** A badge in the iDrive 7 look, as the kit draws them (gauges.js badgeRow): a tinted box, bold capitals. Its width. */
function chip7(cv, text, x, y, h, c, dot, right) {
    const s = Math.round(h * 0.42), label = String(text).toUpperCase(), opt = { align: 'center', font: 'bold', spacing: 1.5 };
    const d = dot ? h * 0.5 : 0, w = Math.max(h * 2.5, cv.textWidth(label, s, opt) + h + d), x0 = right ? x - w : x;
    cv.roundRect(x0, y, w, h, dot ? h / 2 : h * 0.3, withAlpha(c, 0.18));
    if (dot) { cv.circle(x0 + h * 0.55, y + h / 2, h * 0.16, withAlpha(c, 0.35)); cv.circle(x0 + h * 0.55, y + h / 2, h * 0.1, c); }
    cv.text(label, x0 + d + (w - d) / 2, y + h / 2 + s * 0.36, s, c, opt);
    return w;
}

/** Where chips() puts each chip: [{ x, w, it }] (the frame's press targets for chips with an act). */
function chipBoxes(cv, b, o, id7) {
    const items = chipItems(o.items), gap = b.h * 0.25, h = b.h;
    const width = (it) => (id7 ? Math.max(h * 2.5, cv.textWidth(String(it.text).toUpperCase(), Math.round(h * 0.42), { font: 'bold', spacing: 1.5 }) + h)
        : cv.textWidth(it.text, Math.round(h * 0.44)) + h * 0.9 + (it.dot ? h * 0.16 * 3 : 0)) + (id7 && it.dot ? h * 0.5 : 0);
    const out = [];
    let x = o.align === 'right' ? b.x + b.w : b.x;
    if (o.align === 'right') {
        for (let i = items.length - 1; i >= 0; i--) { const w = width(items[i]); x -= w; out.unshift({ x, w, it: items[i] }); x -= gap; }
    } else items.forEach((it) => { const w = width(it); out.push({ x, w, it }); x += w + gap; });
    return out;
}
function chips(cv, t, b, o) {
    const items = chipItems(o.items), gap = b.h * 0.25;
    if (W.id7(t) && o.align === 'right') {
        let x = b.x + b.w;
        for (let i = items.length - 1; i >= 0; i--) x -= chip7(cv, items[i].text, x, b.y, b.h, C(t, items[i].color, t.text), items[i].dot, true) + gap;
        return;
    }
    if (W.id7(t)) {
        let x = b.x;
        for (const it of items) x += chip7(cv, it.text, x, b.y, b.h, C(t, it.color, t.text), it.dot) + gap;
        return;
    }
    if (o.align === 'right') {
        let x = b.x + b.w;
        for (let i = items.length - 1; i >= 0; i--) x -= chip(cv, items[i].text, x, b.y, b.h, C(t, items[i].color, t.text), items[i].dot, true) + gap;
    } else {
        let x = b.x;
        for (const it of items) x += chip(cv, it.text, x, b.y, b.h, C(t, it.color, t.text), it.dot) + gap;
    }
}

function appIconEl(cv, t, b, o) {
    const s = Math.min(b.w, b.h);
    appIcon(cv, t, o, b.x + (b.w - s) / 2, b.y + (b.h - s) / 2, s);
}

// ---- app grid: tiles in rows, scrolled by the pixel (o.top: rows scrolled, fractional) -------------------------
const gridItems = (o) => (Array.isArray(o.items) ? o.items
    : lines(o.items).map((l, i) => ({ id: `item${i}`, title: l[0], sub: l[1] || '', vicon: l[2] || '', colors: l[3] ? `${l[3]},${l[4] || l[3]}` : '' })));
function gridView(b, o) {
    const cols = Math.max(1, o.cols | 0 || 5), th = o.tileH || 274, all = gridItems(o), rows = Math.ceil(all.length / cols);
    const shown = b.h / th, max = Math.max(0, rows - shown), top = Math.max(0, Math.min(max, +o.top || 0));
    return { cols, th, tw: b.w / cols, all, rows, shown, max, top, first: Math.floor(top), end: Math.min(rows, Math.ceil(top + shown)) };
}
/** The ids of the tiles on screen (the app decodes only their icons). */
function visibleIds(b, o) {
    const g = gridView(b, o);
    return g.all.slice(g.first * g.cols, g.end * g.cols).map((a) => a.id);
}
// a source line too long for its tile keeps its repo name whole and shortens the owner
function fitSource(cv, s, w, size) {
    const i = s.lastIndexOf('/');
    if (i < 0 || cv.textWidth(s, size) <= w) return W.fit(cv, s, w, size);
    const repo = s.slice(i);
    return W.fit(cv, s.slice(0, i), Math.max(0, w - cv.textWidth(repo, size)), size) + repo;
}
// a card's source line (owner/repo · version · size): the version kept beside it while there is room, then the owner shortened
function fitCardSource(cv, s, w, size) {
    const j = s.indexOf(' · '), tail = j < 0 ? '' : s.slice(j);
    if (!tail || s.slice(0, j).indexOf('/') < 0 || cv.textWidth(s, size) <= w) return tail ? W.fit(cv, s, w, size) : fitSource(cv, s, w, size);
    const tw = cv.textWidth(tail, size);
    return tw <= w * 0.5 ? fitSource(cv, s.slice(0, j), w - tw, size) + tail : fitSource(cv, s.slice(0, j), w, size);
}
// (the Store: o.iconK, o.titleSize, o.subSize size a smaller tile's icon and texts; the defaults are the design's.
// Tiles with a source line (item.src, dim, under the title) set the three lines closer. The icon leaves the lines,
// descenders included, above the tile's bottom 8 px, where the focus rings are drawn: store_frame.js.)
/* A state's button on a card: kind get (filled), update (tinted), fix (red edge), ok (green edge, a tick), plain (green
 * words, a tick), busy (a turning ring and its %), wait (amber), warn (amber edge), muted (grey edge). Its width. */
const BTN = { get: [null, 'fill'], update: [BLUE, 'tint'], fix: ['#ff4d4d', 'edge'], ok: [GREEN, 'edge'], plain: [GREEN, 'none'], busy: [BLUE, 'tint'],
    wait: [AMBER, 'tint'], warn: [AMBER, 'edge'], muted: ['#9a9ca2', 'edge'] };
function cardButton(cv, t, it, xr, cy, h, maxW) {
    const [c0, style] = BTN[it.kind] || BTN.muted, c = c0 || t.sel || t.accent, s = Math.round(h * 0.36), opt = { font: 'bold', spacing: 1.4 };
    const icon = it.kind === 'ok' || it.kind === 'plain' ? 'check' : it.kind === 'busy' ? 'spin' : '';
    const is = icon ? Math.round(h * 0.42) : 0;
    let label = String(it.text || '').toUpperCase(), size = s;
    const room = maxW - h * 0.8 - (is ? is + 8 : 0);
    while (size > 11 && cv.textWidth(label, size, opt) > room) size -= 0.5;
    label = W.fit(cv, label, room, size, 'bold');
    const w = Math.max(h * 2.2, cv.textWidth(label, size, opt) + h * 0.8 + (is ? is + 8 : 0)), x = xr - w, y = cy - h / 2;
    const r = it.kind === 'busy' || it.kind === 'wait' ? 10 : h / 2;
    if (style === 'fill') cv.roundRect(x, y, w, h, r, c);
    else if (style === 'tint') { cv.roundRect(x, y, w, h, r, withAlpha(c, 0.16)); cv.strokeRoundRect(x, y, w, h, r, 1.5, withAlpha(c, 0.4)); }
    else if (style === 'edge') cv.strokeRoundRect(x, y, w, h, r, 1.5, withAlpha(c, 0.55));
    const fg = style === 'fill' ? '#ffffff' : c, tw = cv.textWidth(label, size, opt) + (is ? is + 8 : 0);
    let tx = x + (w - tw) / 2;
    if (icon === 'check') { vicon(cv, 'check', tx, cy - is / 2, is, fg); tx += is + 8; }
    else if (icon === 'spin') {
        const rr = is / 2, a0 = ((Date.now() / 4) % 360);
        cv.arc(tx + rr, cy, rr - 3, rr, 0, 360, withAlpha(fg, 0.25));
        cv.arc(tx + rr, cy, rr - 3, rr, a0, a0 + 110, fg);
        tx += is + 8;
    }
    cv.text(label, tx, cy + size * 0.36, size, fg, opt);
    return w;
}
/* The cards mode (o.cards, the full-screen iDrive 7 look): each a rounded card - its icon, its name, a line under it and a
 * third (item.state, in item.stateColor) where it has one, its state's button on the right (item.btn: { text, kind }); a
 * picked one (item.selected) outlined in the selection colour; one downloading a bar along its bottom. o.head px over each
 * row's cards hold a part's heading (item.head, item.headColor: the part's first card); items with blank fill a row. */
function cardGrid(cv, t, b, o, g) {
    const head = o.head || 0, ts = o.titleSize || 22, ss = o.subSize || 15, S = t.sel || t.accent;
    cv.clip(b.x, b.y, b.w, b.h);
    g.all.slice(g.first * g.cols, g.end * g.cols).forEach((a, i) => {
        const col = i % g.cols, x = b.x + col * g.tw + 4, y = b.y + (g.first + Math.floor(i / g.cols) - g.top) * g.th;
        if (a.head) {
            const hs = 15, hc = C(t, a.headColor, t.dim);
            cv.roundRect(x, y + head - 22, 4, 16, 2, a.headColor ? hc : S);
            cv.text(String(a.head).toUpperCase(), x + 12, y + head - 8, hs, hc, { font: 'bold', spacing: 2 });
        }
        if (a.blank) return;
        const w = g.tw - 12 - (col === g.cols - 1 ? 14 : 0), cy0 = y + head, h = g.th - head - 6, cy = cy0 + h / 2;
        if (a.selected) {
            cv.card(x, cy0, w, h, 14, [[0, mix('#1a1c22', S, 0.16)], [1, '#16181d']]);
            cv.strokeRoundRect(x, cy0, w, h, 14, 2, S);
        } else {
            cv.card(x, cy0, w, h, 14, [[0, '#1a1c22'], [1, '#141619']]);
            cv.strokeRoundRect(x, cy0, w, h, 14, 1, withAlpha('#ffffff', 0.08));
        }
        const s = Math.min(h - 22, 58);
        appIcon(cv, t, Object.assign({}, a, { progress: -1 }), x + 14, cy - s / 2, s, '#16181d');
        const bw = a.btn ? cardButton(cv, t, a.btn, x + w - 14, cy, Math.min(40, h * 0.5), Math.max(90, w * 0.36)) : 0;
        const tx = x + 14 + s + 16, room = x + w - 14 - bw - (bw ? 12 : 0) - tx;
        const three = !!a.state, ty = three ? cy - 9 : cy - 1;
        cv.text(W.fit(cv, String(a.title || ''), room, ts, 'bold'), tx, ty, ts, t.text, { font: 'bold' });
        cv.text(fitCardSource(cv, String(a.src || ''), room, ss), tx, ty + ss + 5, ss, t.dim);
        if (three) cv.text(W.fit(cv, String(a.state), room, ss - 1), tx, ty + 2 * ss + 8, ss - 1, C(t, a.stateColor, t.dim));
        if (typeof a.progress === 'number' && a.progress >= 0) {
            cv.roundRect(x + 14, cy0 + h - 4, w - 28, 3, 1.5, withAlpha('#ffffff', 0.1));
            cv.roundRect(x + 14, cy0 + h - 4, Math.max(3, (w - 28) * Math.min(1, a.progress)), 3, 1.5, BLUE);
        }
    });
    cv.noclip();
    if (!g.all.length && o.empty) mid(cv, o.empty, b.x + b.w / 2, b.y + b.h / 2, 24, t.dim, { align: 'center' });
}
function appGrid(cv, t, b, o) {
    const g = gridView(b, o), k = g.th / 274;
    if (o.cards) {
        cardGrid(cv, t, b, o, g);
        if (g.max > 0 && o.bar !== false) {
            const h = Math.max(36, b.h * g.shown / g.rows), y = b.y + (b.h - h) * g.top / g.max, bw = 8;
            cv.roundRect(b.x + b.w - bw, b.y, bw, b.h, bw / 2, withAlpha('#ffffff', 0.1));
            cv.roundRect(b.x + b.w - bw, y, bw, h, bw / 2, withAlpha('#ffffff', 0.6));
        }
        return;
    }
    const ts = o.titleSize || 40, ss = o.subSize || 30, rs = Math.round(ss * 0.9), top = 12 * k;
    const src = g.all.some((a) => a.src);
    const gap = src ? [ts * 1.2, rs * 1.25, ss * 1.25] : [ts * 1.45, 0, ss * 1.4];
    // the icon leaves the title and status lines, descenders included, above the tile's bottom 8 px (with or
    // without a source line): a short tile (iDrive 7's Store page) has a smaller icon, not lines over the next row
    const s = Math.floor(Math.min(g.th * (o.iconK || 0.5), g.th - 8 - top - gap[0] - gap[1] - (src ? gap[2] : 0) - ss * (src ? 0.25 : 1.65)));
    cv.clip(b.x, b.y, b.w, b.h);
    g.all.slice(g.first * g.cols, g.end * g.cols).forEach((a, i) => {
        const x = b.x + (i % g.cols) * g.tw, y = b.y + (g.first + Math.floor(i / g.cols) - g.top) * g.th;
        if (W.id7(t)) {
            // a card under the tile (a little in from its cell, the scroll bar's room on the right)
            const cx0 = x + 6, cw0 = g.tw - 12 - (i % g.cols === g.cols - 1 ? 12 : 0), ch0 = g.th - 10;
            cv.card(cx0, y + 2, cw0, ch0, 14, [[0, '#171a20'], [1, '#101217']]);
            cv.strokeRoundRect(cx0, y + 2, cw0, ch0, 14, 1, withAlpha('#ffffff', 0.07));
            if (typeof a.progress === 'number' && a.progress >= 0) {
                cv.roundRect(cx0 + 14, y + 2, cw0 - 28, 4, 2, withAlpha('#ffffff', 0.12));
                cv.roundRect(cx0 + 14, y + 2, Math.max(4, (cw0 - 28) * Math.min(1, a.progress)), 4, 2, BLUE);
            }
        }
        appIcon(cv, t, a, x + (g.tw - s) / 2, y + top, s);
        const ny = y + top + s + gap[0], sy = ny + gap[1];
        cv.text(W.fit(cv, String(a.title || ''), g.tw - 16, ts, 'bold'), x + g.tw / 2, ny, ts, t.text, { align: 'center', font: 'bold' });
        if (a.src) cv.text(fitSource(cv, String(a.src), g.tw - 16, rs), x + g.tw / 2, sy, rs, t.dim, { align: 'center' });
        if (a.sub && W.id7(t) && C(t, a.subColor, t.dim) !== t.dim) {
            // the state as a chip in its colour, centred under the source
            const ch = Math.round(Math.max(30, ss * 1.45)), label = W.fit(cv, String(a.sub).toUpperCase(), g.tw - 60, Math.round(ch * 0.42), 'bold');
            const cw1 = Math.max(ch * 2.5, cv.textWidth(label, Math.round(ch * 0.42), { font: 'bold', spacing: 1.5 }) + ch);
            chip7(cv, label, x + (g.tw - cw1) / 2, sy + gap[2] - ss * 0.8 - (ch - ss) / 2, ch, C(t, a.subColor, t.dim));
        } else if (a.sub) cv.text(W.fit(cv, String(a.sub), g.tw - 16, ss), x + g.tw / 2, sy + gap[2], ss, C(t, a.subColor, t.dim), { align: 'center' });
    });
    cv.noclip();
    if (!g.all.length && o.empty) mid(cv, o.empty, b.x + b.w / 2, b.y + b.h / 2, 36, t.dim, { align: 'center' });
    if (g.max > 0 && o.bar !== false) { // scroll bar (o.bar false: none, store_frame.js's drag rows): its track, the thumb on it
        const h = Math.max(36, b.h * g.shown / g.rows), y = b.y + (b.h - h) * g.top / g.max, bw = 8;
        cv.roundRect(b.x + b.w - bw, b.y, bw, b.h, bw / 2, withAlpha('#ffffff', 0.1));
        cv.roundRect(b.x + b.w - bw, y, bw, h, bw / 2, withAlpha('#ffffff', 0.6));
    }
}

// ---- list rows with a picture / vector icon and a control on the right ---------------------------------------
const rowItems = (o) => (Array.isArray(o.items) ? o.items
    : lines(o.items).map((l, i) => ({ id: `row${i}`, title: l[0], sub: l[1] || '', right: l[2] || 'chevron', vicon: l[3] || '' })));
function listView(b, o) {
    const rh = o.rowH || 120, all = rowItems(o), n = b.h / rh, max = Math.max(0, all.length - n), top = Math.max(0, Math.min(max, +o.top || 0));
    return { rh, all, n, max, top, first: Math.floor(top), end: Math.min(all.length, Math.ceil(top + n)) };
}
// the right-hand controls of a row ("toggle:on+trash": laid out from the right) -> [{ kind, arg, x, w }]
const RIGHT_W = { chevron: 60, trash: 80, toggle: 150 };
// (the Store: c scales the controls of a smaller row, o.ctlK)
function rightBoxes(b, it, cv, c) {
    let x = b.x + b.w;
    const k = c || 1;
    return String(it.right || '').split('+').filter(Boolean).reverse().map((r) => {
        const kind = r.split(':')[0], arg = r.slice(kind.length + 1);
        const w = (kind === 'chip' ? cv.textWidth(arg, 26 * k) + 54 * k : (RIGHT_W[kind] || 0) * k) + 24 * k;
        x -= w;
        return { kind, arg, x, w };
    });
}
// (the Store: o.titleSize, o.subSize and o.ctlK size a smaller row's texts and controls; the defaults are the design's)
function appList(cv, t, b, o) {
    const v = listView(b, o), gap = Math.round(v.rh * 0.13), q = o.ctlK || 1, ts = o.titleSize || 40, ss = o.subSize || 30;
    cv.clip(b.x, b.y, b.w, b.h);
    v.all.slice(v.first, v.end).forEach((it, k) => {
        const y = b.y + (v.first + k - v.top) * v.rh, h = v.rh - gap, s = Math.round(h * 0.73);
        // a line of text (the changelog's notes): no card
        if (it.note) { cv.text(String(it.title || ''), b.x + 28 * q + (it.indent || 0) * q, y + h / 2 + ss * 0.36, ss, C(t, it.color, t.text)); return; }
        if (W.id7(t)) {
            cv.card(b.x, y, b.w, h, 12 * q, [[0, '#171a20'], [1, '#121419']]);
            cv.strokeRoundRect(b.x, y, b.w, h, 12 * q, 1, withAlpha('#ffffff', 0.07));
            if (typeof it.progress === 'number' && it.progress >= 0) cv.roundRect(b.x + 6, y + h - 4, Math.max(4, (b.w - 12) * Math.min(1, it.progress)), 3, 1.5, BLUE);
        }
        else cv.card(b.x, y, b.w, h, 22 * q, [[0, t.panelTop], [1, t.panelBottom]]);
        let tx = b.x + 28 * q;
        if (it.icon || it.vicon || it.colors || it.letter) {
            if (it.plain && it.vicon) vicon(cv, it.vicon, b.x + 28 * q, y + (h - s) / 2, s, C(t, it.iconColor, t.text));
            else appIcon(cv, t, it, b.x + 22 * q, y + (h - s) / 2, s, t.panelTop);
            tx = b.x + 22 * q + s + 32 * q;
        }
        const boxes = rightBoxes(b, it, cv, q), room = (boxes.length ? boxes[boxes.length - 1].x : b.x + b.w) - tx - 8;
        cv.text(W.fit(cv, String(it.title || ''), room, ts, 'bold'), tx, it.sub ? y + h * 0.47 : y + h / 2 + ts * 0.36, ts, t.text, { font: 'bold' });
        if (it.sub) cv.text(W.fit(cv, String(it.sub), room, ss), tx, y + h * 0.83, ss, C(t, it.subColor, t.dim));
        const cy = y + h / 2;
        for (const rb of boxes) {
            const re = rb.x + rb.w - 24 * q;                // the control's right edge
            if (rb.kind === 'chevron') W.chevron(cv, re - 28 * q, cy, 22 * q, 'right', 4 * q, t.dim);
            else if (rb.kind === 'trash') vicon(cv, 'trash', re - 66 * q, cy - 30 * q, 60 * q, t.dim);
            else if (rb.kind === 'toggle') {
                const on = rb.arg === 'on', tw = 150 * q, th = 76 * q, tx0 = re - tw;
                cv.roundRect(tx0, cy - th / 2, tw, th, th / 2, on ? GREEN : '#3a4352');
                cv.circle(on ? tx0 + tw - th / 2 : tx0 + th / 2, cy, th / 2 - 8 * q, '#ffffff');
            } else if (rb.kind === 'chip') (W.id7(t) ? chip7 : chip)(cv, rb.arg, re, cy - 30 * q, 60 * q, C(t, it.chipColor, BLUE), it.chipDot, true);
        }
    });
    cv.noclip();
    if (!v.all.length && o.empty) mid(cv, o.empty, b.x + b.w / 2, b.y + b.h / 2, 36, t.dim, { align: 'center' });
    // o.scrollbar: while it holds more rows than show, a thin bar at its right edge says where the rows shown are
    if ((o.scrollbar || W.id7(t)) && v.max > 0) {
        const bw = Math.max(4, Math.round(6 * (o.ctlK || 1))), bx = b.x + b.w - bw, th = Math.max(bw * 4, b.h * v.n / v.all.length);
        cv.roundRect(bx, b.y, bw, b.h, bw / 2, withAlpha('#ffffff', 0.12));
        cv.roundRect(bx, b.y + (b.h - th) * (v.top / v.max), bw, th, bw / 2, withAlpha('#ffffff', 0.55));
    }
}

// ---- side menu with vector icons and count badges ------------------------------------------------------------
const navItems = (o) => (Array.isArray(o.items) ? o.items
    : lines(o.items).map((l, i) => ({ id: l[0].toLowerCase(), label: l[0], vicon: l[1] || '', badge: l[2] || '' })));
// (the Store: o.labelSize for a narrower menu; the default is the design's)
/* The menu as the iDrive 7 look has it: along the bottom, the kit's button bar (gauges.js menuBar): names in capitals,
 * the selected one lit with a line of the selection colour, thin separators; a count after a name. */
/* The pages as header tabs in the HMI's title strip (full screen, iDrive 7 look): the idrive7-apps' header (kit
 * gauges.js header) - names in capitals, the page lit with a red line along the bottom. */
function headNav(cv, t, b, o) {
    const items = navItems(o), n = Math.max(1, items.length), iw = b.w / n, S = t.sel || t.accent, size = o.labelSize || 20;
    const opt = { align: 'center', font: 'bold', spacing: 2 };
    items.forEach((it, i) => {
        const x = b.x + i * iw, on = i === (o.sel | 0), label = String(it.label).toUpperCase();
        const badge = it.badge && String(it.badge) !== '0' ? String(it.badge) : '';
        const lw = cv.textWidth(label, size, opt), bw = badge ? size * 1.3 : 0, lx = x + iw / 2 - (badge ? (bw + 10) / 2 : 0);
        if (on) cv.roundRect(lx - 18, b.y + b.h - 16, 36, 4, 2, S);
        cv.text(label, lx, b.y + b.h / 2 + 7, size, on ? '#ffffff' : t.dim, opt);
        if (badge) {
            const bx = lx + lw / 2 + 10 + bw / 2, cy = b.y + b.h / 2;
            cv.roundRect(bx - bw / 2, cy - size * 0.65, bw, size * 1.3, size * 0.65, S);
            cv.text(badge, bx, cy + size * 0.3, Math.round(size * 0.82), '#ffffff', { align: 'center', font: 'bold' });
        }
        if (i < n - 1) cv.fillRect(x + iw, b.y + b.h * 0.28, 1, b.h * 0.44, withAlpha('#ffffff', 0.14));
    });
}

function bottomNav(cv, t, b, o) {
    if (o.head) return headNav(cv, t, b, o);
    const items = navItems(o), n = Math.max(1, items.length), iw = b.w / n, S = t.sel || t.accent, size = o.labelSize || 22;
    cv.fillRect(b.x, b.y, b.w, b.h, t.bg);
    cv.gradientRect(b.x, b.y, b.w, b.h, [[0, withAlpha('#ffffff', 0.09)], [1, withAlpha('#ffffff', 0.03)]]);
    cv.fillRect(b.x, b.y, b.w, 2, withAlpha('#ffffff', 0.2));
    items.forEach((it, i) => {
        const x = b.x + i * iw, on = i === (o.sel | 0), label = String(it.label).toUpperCase(), opt = { align: 'center', font: 'bold', spacing: 2 };
        if (on) {
            cv.gradientRect(x, b.y, iw, b.h, [[0, withAlpha(S, 0.08)], [1, withAlpha(S, 0.4)]]);
            cv.fillRect(x, b.y + b.h - 4, iw, 4, S);
        }
        const cy = b.y + b.h / 2, badge = it.badge && String(it.badge) !== '0' ? String(it.badge) : '';
        const lw = cv.textWidth(label, size, opt), bw = badge ? size * 1.5 : 0, lx = x + iw / 2 - (badge ? (bw + 10) / 2 : 0);
        cv.text(label, lx, cy + size * 0.36, size, on ? t.selText || '#ffffff' : t.dim, opt);
        if (badge) {
            const bx = lx + lw / 2 + 10 + bw / 2;
            cv.roundRect(bx - bw / 2, cy - size * 0.7, bw, size * 1.4, size * 0.28, S);
            cv.text(badge, bx, cy + size * 0.3, Math.round(size * 0.82), '#ffffff', { align: 'center', font: 'bold' });
        }
        if (i < n - 1) cv.fillRect(x + iw, b.y + b.h * 0.25, 1, b.h * 0.5, withAlpha('#ffffff', 0.13));
    });
}

function sideNav(cv, t, b, o) {
    if (b.w > b.h) return bottomNav(cv, t, b, o);
    const items = navItems(o), ih = b.h / Math.max(1, items.length), is = Math.min(68, ih * 0.38), ls = o.labelSize || 34;
    cv.fillRect(b.x, b.y, b.w, b.h, withAlpha(t.panelBottom, 0.85));
    cv.fillRect(b.x + b.w - 1.5, b.y, 1.5, b.h, t.panelEdge);
    items.forEach((it, i) => {
        const y = b.y + i * ih, on = i === (o.sel | 0), c = on ? t.text : t.dim, iy = y + ih * 0.18;
        if (on && W.id7(t)) {           // the iDrive 7 look: a lit square with the red bar
            cv.card(b.x, y + 4, b.w - 1.5, ih - 8, 0, [[0, withAlpha('#ffffff', 0.12)], [1, withAlpha('#ffffff', 0.03)]]);
            cv.fillRect(b.x, y + 4, 6, ih - 8, t.sel);
        } else if (on) {
            cv.card(b.x + 8, y + 8, b.w - 24, ih - 16, 16, [[0, withAlpha('#ffffff', 0.16)], [1, withAlpha('#ffffff', 0.04)]]);
            cv.roundRect(b.x + 8, y + ih * 0.22, 6, ih * 0.56, 3, t.text);
        }
        vicon(cv, it.vicon, b.x + b.w / 2 - is / 2, iy, is, c);
        const ts = W.shrink(cv, String(it.label), b.w - 24, ls, 'label', 0.6);
        cv.text(W.fit(cv, String(it.label), b.w - 24, ts), b.x + b.w / 2, iy + is + ls * 1.47, ts, c, { align: 'center' });
        if (it.badge && String(it.badge) !== '0') {
            const bx = b.x + b.w / 2 + is * 0.97, by = iy + 6;
            cv.circle(bx, by, 30, t.bg); cv.circle(bx, by, 26, W.id7(t) ? t.sel : BLUE);
            cv.text(String(it.badge), bx, by + 12, 32, '#ffffff', { align: 'center', font: 'bold' });
        }
    });
}

// ---- button with a vector icon -------------------------------------------------------------------------------
function vbutton(cv, t, b, o) {
    const c = C(t, o.color, BLUE), s = o.size || Math.round(b.h * 0.34), is = Math.round(b.h * 0.4), r = Math.min(18, b.h / 2);
    const off = o.disabled;
    if (o.style === 'round') {                       // an icon on a soft disc (back, close)
        const d = Math.min(b.w, b.h), g = d * 0.55;
        cv.circle(b.x + b.w / 2, b.y + b.h / 2, d / 2, withAlpha(off ? t.dim : c, 0.14));
        vicon(cv, o.vicon, b.x + (b.w - g) / 2, b.y + (b.h - g) / 2, g, off ? t.dim : c);
        return;
    }
    if (W.id7(t)) return vbutton7(cv, t, b, o, c, s, is, off);
    if (o.style === 'primary') cv.card(b.x, b.y, b.w, b.h, r, off ? [[0, '#2a3341'], [1, '#232a35']] : [[0, c], [1, withAlpha(c, 0.78)]]);
    else cv.strokeRoundRect(b.x, b.y, b.w, b.h, r, 3, off ? t.panelEdge : o.style === 'outline' ? withAlpha(t.text, 0.6) : withAlpha(c, 0.6));
    const fg = off ? t.dim : o.style === 'primary' ? '#ffffff' : o.style === 'outline' ? t.text : c;
    const hasIcon = !!o.vicon, room = b.w - 2 * r - (hasIcon ? is + 18 : 0);
    const ts = W.shrink(cv, String(o.text || ''), room, s, 'bold'), text = W.fit(cv, String(o.text || ''), room, ts, 'bold');
    const tw = cv.textWidth(text, ts, { font: 'bold' }) + (hasIcon ? is + 18 : 0), x1 = b.x + (b.w - tw) / 2;
    if (hasIcon) vicon(cv, o.vicon, x1, b.y + (b.h - is) / 2, is, fg);
    cv.text(text, x1 + (hasIcon ? is + 18 : 0), b.y + b.h / 2 + ts * 0.36, ts, fg, { font: 'bold' });
}

/* A button in the iDrive 7 look, as the kits' buttons (gauges.js button): rounded corners, a light fill and edge, the
 * name in capitals; primary filled in its colour (the selection colour where it has none). */
function vbutton7(cv, t, b, o, c, s, is, off) {
    const primary = o.style === 'primary' && !off, S = o.color ? c : t.sel || t.accent, r = Math.min(12, b.h / 2);
    if (primary) cv.roundRect(b.x, b.y, b.w, b.h, r, S);
    else {
        cv.roundRect(b.x, b.y, b.w, b.h, r, withAlpha('#ffffff', 0.09));
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, r, 1.5, withAlpha('#ffffff', off ? 0.1 : 0.2));
    }
    const fg = off ? withAlpha(t.dim, 0.5) : primary ? '#ffffff' : t.text;
    const label = String(o.text || '').toUpperCase(), hasIcon = !!o.vicon, room = b.w - 32;
    // a name too wide for the button: less letter spacing, then a smaller size
    let sp = 2;
    const w = () => cv.textWidth(label, s, { font: 'bold', spacing: sp }) + (hasIcon ? is + 16 : 0);
    if (w() > room) sp = 0.5;
    while (w() > room && s > 14) s -= 1;
    const x1 = b.x + (b.w - w()) / 2;
    if (hasIcon) vicon(cv, o.vicon, x1, b.y + (b.h - is) / 2, is, fg);
    cv.text(label, x1 + (hasIcon ? is + 16 : 0), b.y + b.h / 2 + s * 0.36, s, fg, { font: 'bold', spacing: sp });
}

// ---- on-screen keyboard: URLs and tokens (layout 'url'), or words (layout 'text': a space bar) ----------------
const ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ['Delete', 1.3, 'mod']],
    [['Shift', 1.3, 'mod'], 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '/'],
    [['https://', 1.6, 'mod'], ['github.com/', 2.1, 'mod'], ['.com', 1.2, 'mod'], ['-', 0.8], ['_', 0.8], [':', 0.8], ['Next', 1.7, 'go']],
];
const TEXT_ROWS = ROWS.slice(0, 3).concat([
    [['Shift', 1.3, 'mod'], 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
    [['-', 0.8], ["'", 0.8], ['Space', 5.2, 'mod'], ['?', 0.8], ['!', 0.8], ['Next', 1.7, 'go']],
]);
// o.symbols (word keyboard only): a '#+=' key opens the symbols page (o.sym), 'abc' goes back - all the printable ASCII
// symbols (a Wi-Fi password may hold any), the digits stay on top
const SYM_KEY = '#+=', ABC_KEY = 'abc';
const TEXT_SYM_ROWS = TEXT_ROWS.slice(0, 4).concat([[[SYM_KEY, 1.3, 'mod'], ["'", 0.8], ['Space', 4.7, 'mod'], ['?', 0.8], ['!', 0.8], ['Next', 1.7, 'go']]]);
const SYM_ROWS = [ROWS[0],
    ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
    ['-', '_', '=', '+', '[', ']', '{', '}', '\\', ['Delete', 1.3, 'mod']],
    [';', ':', '"', "'", ',', '.', '/', '<', '>', '?'],
    [[ABC_KEY, 1.3, 'mod'], ['`', 0.8], ['|', 0.8], ['Space', 4.7, 'mod'], ['~', 0.8], ['Next', 1.7, 'go']]];
/** Every key's box: { text, kind, x, y, w, h } (design px). o.layout 'text': the word keyboard (+ o.symbols, o.sym). */
function keyBoxes(b, o) {
    const rows = o && o.layout === 'text' ? (o.symbols ? (o.sym ? SYM_ROWS : TEXT_SYM_ROWS) : TEXT_ROWS) : ROWS;
    const gap = 16, rh = (b.h - gap * (rows.length - 1)) / rows.length, out = [];
    rows.forEach((r, ri) => {
        const ks = r.map((k) => (Array.isArray(k) ? k : [k, 1])), tw = ks.reduce((a, k) => a + k[1], 0), unit = (b.w - gap * (ks.length - 1)) / tw;
        let kx = b.x;
        ks.forEach(([text, wt, kind]) => { out.push({ text, kind, x: kx, y: b.y + ri * (rh + gap), w: unit * wt, h: rh }); kx += unit * wt + gap; });
    });
    return out;
}
// the Enter key says o.go (e.g. 'Search') and types that; default 'Next'
const shown = (k, o) => (k.kind === 'go' ? o.go || k.text : o.shift && !k.kind && /^[a-z]$/.test(k.text) ? k.text.toUpperCase() : k.text);
// what a key says: Space, Delete and Shift in the display language (the key itself stays the English name)
const keyLabel = (s) => ({ Space: tr("Space"), Delete: tr("Delete"), Shift: tr("Shift") })[s] || s;
function keyboard(cv, t, b, o) {
    keyBoxes(b, o).forEach((k, i) => {
        const press = i === o.pressed;
        const fill = k.kind === 'go' ? [[0, '#5fb4ff'], [1, '#1f5fd0']] : press ? [[0, '#4a5568'], [1, '#3a4352']]
            : k.kind === 'mod' ? (k.text === 'Shift' && o.shift ? [[0, '#3d4a5e'], [1, '#2e3949']] : [[0, '#232b38'], [1, '#18202b']]) : [[0, '#2a3341'], [1, '#1d2430']];
        cv.card(k.x, k.y, k.w, k.h, 18, fill);
        const label = keyLabel(shown(k, o));
        const font = k.kind ? 'bold' : 'label', size = W.shrink(cv, label, k.w - 16, label.length > 2 ? 38 : 48, font);
        cv.text(W.fit(cv, label, k.w - 16, size, font), k.x + k.w / 2, k.y + k.h / 2 + 17, size, '#ffffff', { align: 'center', font });
    });
}

// ---- sheet: dims the app area, a card on top (other elements sit on it) --------------------------------------
function sheet(cv, t, b, o) {
    const a = o.area || { x: 0, y: 0, w: 2880, h: 960 };
    cv.fillRect(a.x, a.y, a.w, a.h, withAlpha('#000000', o.dim == null ? 0.55 : o.dim));
    if (W.id7(t)) W.panel7(cv, t, b.x, b.y, b.w, b.h, true);
    else cv.card(b.x, b.y, b.w, b.h, o.radius == null ? 32 : o.radius, [[0, '#1e2632'], [1, '#121820']]);
}

/* A note: a box tinted in its tone (o.tone red, amber, blue; else grey), its title in bold capitals in the tone, the text
 * wrapped under it (as many lines as the box holds). Nothing when both are empty. */
const TONES = { red: '#ff4d4d', amber: AMBER, blue: BLUE };
function note(cv, t, b, o) {
    if (!o.title && !o.text) return;
    if (o.bare) {
        cv.roundRect(b.x, b.y + 4, 4, 16, 2, t.sel || t.accent);
        cv.text(String(o.title).toUpperCase(), b.x + 12, b.y + 18, 15, t.dim, { font: 'bold', spacing: 2 });
        return;
    }
    const c = TONES[o.tone] || null, r = 12, p = 12;
    // a title alone: one line at the box's foot (next to what follows it)
    const bx = o.text ? b : { x: b.x, y: b.y + b.h - 44, w: b.w, h: 44 };
    cv.roundRect(bx.x, bx.y, bx.w, bx.h, r, c ? withAlpha(c, 0.12) : withAlpha('#ffffff', 0.05));
    cv.strokeRoundRect(bx.x, bx.y, bx.w, bx.h, r, 1, c ? withAlpha(c, 0.45) : withAlpha('#ffffff', 0.1));
    if (!o.text) {
        cv.text(W.fit(cv, String(o.title).toUpperCase(), bx.w - 2 * p, 15, 'bold'), bx.x + p, bx.y + 28, 15, c || BLUE, { font: 'bold', spacing: 1.6 });
        return;
    }
    let y = b.y + p;
    if (o.title) { cv.text(W.fit(cv, String(o.title).toUpperCase(), b.w - 2 * p, 14, 'bold'), b.x + p, y + 12, 14, c || BLUE, { font: 'bold', spacing: 1.6 }); y += 22; }
    const size = o.size || 16, room = Math.floor((b.y + b.h - p - y + size * 0.3) / (size * 1.3));
    if (o.text && room > 0) W.wrap(cv, String(o.text), b.x + p, y, b.w - 2 * p, size, c ? mix(c, '#ffffff', 0.55) : t.text, room);
}
const DRAW = { appIcon: appIconEl, chips, appGrid, appList, sideNav, vbutton, keyboard, sheet, note };

// ---- touch (gpu.js touchElement: Try mode and the app) -------------------------------------------------------
// a drag scrolls with the finger; a release without a drag is a tap. ponytail: one gesture at a time.
let drag = null;
function scroller(view, rowSize) {
    return Object.assign((cv, b, o, p) => {
        const v = view(b, o);
        if (!p.move) { drag = { y0: p.y, top: v.top, moved: false }; return false; }
        const d = drag, dy = d ? p.y - d.y0 : 0, size = rowSize(v);
        if (!d || (!d.moved && Math.abs(dy) < size * 0.25)) return false;
        d.moved = true;
        const nt = Math.max(0, Math.min(v.max, d.top - dy / size));
        if (nt === v.top) return false;
        o.top = nt;
    }, { drag: true });
}
const gridTry = scroller(gridView, (v) => v.th);
gridTry.up = (cv, b, o, p) => {
    const d = drag, g = gridView(b, o);
    drag = null;
    if (!d || d.moved) return false;
    const col = Math.floor((p.x - b.x) / g.tw), row = Math.floor((p.y - b.y) / g.th + g.top), it = g.all[row * g.cols + col];
    if (!it || col < 0 || col >= g.cols) return false;
    tapped(o, it.id, 'tile');
};
const listTry = scroller(listView, (v) => v.rh);
listTry.up = (cv, b, o, p) => {
    const d = drag, v = listView(b, o);
    drag = null;
    if (!d || d.moved) return false;
    const it = v.all[Math.floor((p.y - b.y) / v.rh + v.top)];
    if (!it) return false;
    const rb = rightBoxes(b, it, cv, o.ctlK).find((x) => p.x >= x.x && p.x < x.x + x.w && ['toggle', 'trash', 'chip'].indexOf(x.kind) >= 0);
    tapped(o, it.id, rb ? rb.kind : 'row');
};
const TRY = {
    appGrid: gridTry,
    appList: listTry,
    sideNav: (cv, b, o, p) => {
        const items = navItems(o), i = Math.max(0, Math.min(items.length - 1, Math.floor((p.y - b.y) / (b.h / Math.max(1, items.length)))));
        if (!items.length) return false;
        o.sel = i;
        tapped(o, items[i].id, 'nav');
    },
    keyboard: Object.assign((cv, b, o, p) => {
        const ks = keyBoxes(b), i = ks.findIndex((k) => p.x >= k.x && p.x < k.x + k.w && p.y >= k.y && p.y < k.y + k.h);
        if (i < 0) return false;
        const text = shown(ks[i], o);
        if (text === 'Shift') o.shift = !o.shift;
        o.pressed = i; o.keyN = (o.keyN || 0) + 1; o.key = { text, n: o.keyN };
    }, { up: (cv, b, o) => { if (o.pressed == null) return false; o.pressed = null; } }),
};

// (the Store: shown is what a key types, store_frame.js's items)
module.exports = { DRAW, TRY, appIcon, chip, chipBoxes, visibleIds, keyBoxes, shown, gridView, listView, rightBoxes, navItems, GREEN, BLUE, AMBER };
