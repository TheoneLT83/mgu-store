#!/usr/bin/env node
'use strict';
/*
 * Read-only probe for mgu-render's embed path on the head unit (Node 8, no dependencies).
 *
 *   node probe.js globals [display...]        Wayland globals of each display (default: wayland-0 and
 *                                             wayland-1 in /run/wayland), with wl_shm, wl_drm and
 *                                             zwp_linux_dmabuf_v1 bound and their events listed
 *   node probe.js gpu                         DRM devices, i915 frequencies, the GL libraries
 *                                             HmiMain3D and mgu-render have loaded, /dev/dri
 *   node probe.js cpu [seconds] [--gpu-freq]  per-second CPU of mgu-render, HmiMain3D (per thread), the Store and
 *                                             the whole system, and the fastest core's clock (cpufreq) with its
 *                                             policy (default 10 s)
 *   node probe.js all                         globals, then gpu
 *
 *   --json <file>   also write the results as JSON
 *
 * It only reads (/proc, /sys, /dev/dri, the Wayland sockets, /etc/passwd and /etc/group, the App
 * Manager's registry); the one file it writes is the --json file.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');

const WAYLAND_DIR = '/run/wayland';
const TIMEOUT_MS = 3000;
const CLK_TCK = 100;                 // USER_HZ on x86-64 Linux
const MGR_APPS = '/var/opt/public/oap/oap_12201/data/apps';
const STORE_ID = 'robertn_store';   // its registry entry names its uid

/* ---- small helpers ------------------------------------------------------------------------- */

function read(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}
function readTrim(file) {
    const s = read(file);
    return s === null ? null : s.trim();
}
function readlink(file) {
    try { return fs.readlinkSync(file); } catch (e) { return null; }
}
function ls(dir) {
    try { return fs.readdirSync(dir); } catch (e) { return []; }
}
function hex(n, w) {
    let s = (n >>> 0).toString(16);
    while (s.length < (w || 0)) s = '0' + s;
    return '0x' + s;
}
function pad(s, w) {
    s = String(s);
    while (s.length < w) s += ' ';
    return s;
}
function lpad(s, w) {
    s = String(s);
    while (s.length < w) s = ' ' + s;
    return s;
}

/* ---- Wayland wire protocol ----------------------------------------------------------------- */

const SHM_NAMES = { 0: 'ARGB8888', 1: 'XRGB8888' };
const MODIFIER_NAMES = {
    '0x0000000000000000': 'LINEAR',
    '0x00ffffffffffffff': 'INVALID',
    '0x0100000000000001': 'I915_X_TILED',
    '0x0100000000000002': 'I915_Y_TILED',
    '0x0100000000000003': 'I915_Yf_TILED',
    '0x0100000000000004': 'I915_Y_TILED_CCS',
    '0x0100000000000005': 'I915_Yf_TILED_CCS'
};
const DRM_CAP_PRIME = 1;
/* What to bind, and the highest version asked for: zwp_linux_dmabuf_v1 v4 sends its formats
 * through a file descriptor, so v3 at most. */
const BIND = { wl_shm: 1, wl_drm: 2, zwp_linux_dmabuf_v1: 3 };

function fourcc(code) {
    code = code >>> 0;
    if (SHM_NAMES[code] !== undefined && code < 2) return SHM_NAMES[code];
    let s = '';
    for (let i = 0; i < 4; i++) {
        const c = (code >>> (8 * i)) & 0xff;
        if (c < 0x20 || c > 0x7e) return hex(code, 8);
        s += String.fromCharCode(c);
    }
    return s.replace(/ +$/, '');
}
function modifierHex(hi, lo) {
    return hex(hi, 8) + hex(lo, 8).slice(2);
}

function encString(s) {
    const body = Buffer.from(s + '\0', 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length, 0);
    const padLen = (4 - (body.length % 4)) % 4;
    return Buffer.concat([len, body, Buffer.alloc(padLen)]);
}
function encU32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return b;
}
function message(id, opcode, args) {
    const body = Buffer.concat(args);
    const head = Buffer.alloc(8);
    head.writeUInt32LE(id, 0);
    head.writeUInt32LE((((8 + body.length) << 16) | opcode) >>> 0, 4);
    return Buffer.concat([head, body]);
}

/* Reads the arguments of one event: 'u' u32, 'i' i32, 's' string. */
function decode(buf, sig) {
    const out = [];
    let off = 0;
    for (let i = 0; i < sig.length; i++) {
        if (off + 4 > buf.length) throw new Error('short message');
        if (sig[i] === 'u') { out.push(buf.readUInt32LE(off)); off += 4; }
        else if (sig[i] === 'i') { out.push(buf.readInt32LE(off)); off += 4; }
        else if (sig[i] === 's') {
            const len = buf.readUInt32LE(off);
            off += 4;
            if (len === 0) { out.push(null); continue; }
            if (off + len > buf.length) throw new Error('short string');
            out.push(buf.toString('utf8', off, off + len - 1));
            off += len + ((4 - (len % 4)) % 4);
        }
    }
    return out;
}

function socketPath(display) {
    return display.indexOf('/') >= 0 ? display : path.join(WAYLAND_DIR, display);
}

/* Connects to one display, lists its globals, binds wl_shm, wl_drm and zwp_linux_dmabuf_v1 and
 * collects their events across a second roundtrip, then disconnects. */
function probeDisplay(display, timeoutMs) {
    const file = socketPath(display);
    const res = {
        display: display, path: file, ok: false, error: null, globals: [],
        shm: null, drm: null, dmabuf: null, deleted: []
    };
    return new Promise((resolve) => {
        const objects = { 1: 'wl_display' };
        let nextId = 2, stage = 0, finished = false, inbuf = Buffer.alloc(0);
        const sock = net.connect(file);
        const done = (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (err && !res.error) res.error = err;
            res.ok = !res.error;
            sock.destroy();
            resolve(res);
        };
        const timer = setTimeout(() => done('timed out after ' + timeoutMs + ' ms' +
            (stage === 0 ? ' waiting for the registry' : ' waiting for the bound globals')), timeoutMs);
        const newId = (iface) => { const id = nextId++; objects[id] = iface; return id; };
        const sync = () => {
            const cb = newId('wl_callback');
            sock.write(message(1, 0, [encU32(cb)]));
        };
        const bindAll = () => {
            const reg = 2;
            res.globals.forEach((g) => {
                const max = BIND[g.interface];
                if (!max || (g.interface === 'wl_shm' && res.shm) || (g.interface === 'wl_drm' && res.drm) ||
                    (g.interface === 'zwp_linux_dmabuf_v1' && res.dmabuf)) return;
                const v = Math.min(max, g.version);
                const id = newId(g.interface);
                sock.write(message(reg, 0, [encU32(g.name), encString(g.interface), encU32(v), encU32(id)]));
                if (g.interface === 'wl_shm') res.shm = { version: v, formats: [] };
                if (g.interface === 'wl_drm') res.drm = { version: v, device: null, capabilities: null, prime: null, authenticated: false, formats: [] };
                if (g.interface === 'zwp_linux_dmabuf_v1') res.dmabuf = { version: v, formats: [], modifiers: [] };
            });
            sync();
        };
        const handle = (id, op, body) => {
            const iface = objects[id];
            if (iface === 'wl_display') {
                if (op === 0) {
                    const a = decode(body, 'uus');
                    res.error = 'wl_display.error: object ' + a[0] + ' (' + (objects[a[0]] || '?') + ') code ' + a[1] + ': ' + a[2];
                    done();
                } else if (op === 1) {
                    const d = decode(body, 'u')[0];
                    res.deleted.push(d);
                    delete objects[d];
                }
            } else if (iface === 'wl_registry') {
                if (op === 0) {
                    const a = decode(body, 'usu');
                    res.globals.push({ name: a[0], interface: a[1], version: a[2] });
                } else if (op === 1) {
                    const n = decode(body, 'u')[0];
                    res.globals = res.globals.filter((g) => g.name !== n);
                }
            } else if (iface === 'wl_callback') {
                if (op === 0) {
                    stage++;
                    if (stage === 1) bindAll();
                    else done();
                }
            } else if (iface === 'wl_shm') {
                if (op === 0) res.shm.formats.push(decode(body, 'u')[0]);
            } else if (iface === 'wl_drm') {
                if (op === 0) res.drm.device = decode(body, 's')[0];
                else if (op === 1) res.drm.formats.push(decode(body, 'u')[0]);
                else if (op === 2) res.drm.authenticated = true;
                else if (op === 3) {
                    const c = decode(body, 'u')[0];
                    res.drm.capabilities = c;
                    res.drm.prime = !!(c & DRM_CAP_PRIME);
                }
            } else if (iface === 'zwp_linux_dmabuf_v1') {
                if (op === 0) res.dmabuf.formats.push(decode(body, 'u')[0]);
                else if (op === 1) {
                    const a = decode(body, 'uuu');
                    res.dmabuf.modifiers.push({ format: a[0], modifier: modifierHex(a[1], a[2]) });
                }
            }
        };
        sock.on('connect', () => {
            const reg = newId('wl_registry');
            sock.write(Buffer.concat([message(1, 1, [encU32(reg)])]));
            sync();
        });
        sock.on('data', (d) => {
            inbuf = Buffer.concat([inbuf, d]);
            try {
                while (!finished && inbuf.length >= 8) {
                    const id = inbuf.readUInt32LE(0), word = inbuf.readUInt32LE(4);
                    const size = word >>> 16, op = word & 0xffff;
                    if (size < 8) throw new Error('bad message size ' + size);
                    if (inbuf.length < size) break;
                    const body = inbuf.slice(8, size);
                    inbuf = inbuf.slice(size);
                    handle(id, op, body);
                }
            } catch (e) {
                done('protocol: ' + e.message);
            }
        });
        sock.on('error', (e) => done(e.code || e.message));
        sock.on('close', () => done(stage < 2 ? 'the compositor closed the connection' : null));
    });
}

function textGlobals(r) {
    const out = ['== ' + r.display + ' (' + r.path + ')'];
    if (r.error) out.push('error: ' + r.error);
    if (r.globals.length) {
        out.push('globals (' + r.globals.length + '):');
        r.globals.forEach((g) => out.push('  ' + lpad(g.name, 3) + '  ' + pad(g.interface, 40) + ' v' + g.version));
    }
    if (r.shm) out.push('wl_shm v' + r.shm.version + ': ' + (r.shm.formats.map(fourcc).join(' ') || 'no formats'));
    else if (!r.error) out.push('wl_shm: not offered');
    if (r.drm) {
        out.push('wl_drm v' + r.drm.version + ': device ' + (r.drm.device || '(none sent)') +
            ', capabilities ' + (r.drm.capabilities === null ? '(none sent)' : hex(r.drm.capabilities) + (r.drm.prime ? ' PRIME' : ' (no PRIME)')));
        out.push('  formats: ' + (r.drm.formats.map(fourcc).join(' ') || 'none'));
    } else if (!r.error) out.push('wl_drm: not offered');
    if (r.dmabuf) {
        out.push('zwp_linux_dmabuf_v1 v' + r.dmabuf.version + ':');
        if (r.dmabuf.modifiers.length) {
            const by = {};
            r.dmabuf.modifiers.forEach((m) => {
                const f = fourcc(m.format);
                (by[f] = by[f] || []).push(MODIFIER_NAMES[m.modifier] || m.modifier);
            });
            Object.keys(by).forEach((f) => out.push('  ' + pad(f, 10) + ' ' + by[f].join(', ')));
        }
        if (r.dmabuf.formats.length) out.push('  formats: ' + r.dmabuf.formats.map(fourcc).join(' '));
        if (!r.dmabuf.modifiers.length && !r.dmabuf.formats.length) out.push('  no formats sent');
    } else if (!r.error) out.push('zwp_linux_dmabuf_v1: not offered');
    return out.join('\n');
}

function cmdGlobals(displays) {
    const list = displays.length ? displays : ['wayland-0', 'wayland-1'];
    const results = [];
    return list.reduce((p, d) => p.then(() => probeDisplay(d, TIMEOUT_MS).then((r) => {
        results.push(r);
        console.log(textGlobals(r) + '\n');
    })), Promise.resolve()).then(() => results);
}

/* ---- processes ----------------------------------------------------------------------------- */

function pids() {
    return ls('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
}
function comm(pid, tid) {
    return readTrim('/proc/' + pid + (tid ? '/task/' + tid : '') + '/comm');
}
function byComm(name) {
    return pids().filter((p) => comm(p) === name);
}
/* The Store's processes: those running as the uid its registry entry names (each OAP app runs as
 * its own uid). */
function storePids() {
    let uid = null;
    try { uid = JSON.parse(fs.readFileSync(path.join(MGR_APPS, STORE_ID + '.json'), 'utf8')).userId; } catch (e) { /* not installed */ }
    if (typeof uid !== 'number') return [];
    return pids().filter((p) => {
        const m = /^Uid:\s+(\d+)/m.exec(read('/proc/' + p + '/status') || '');
        return m !== null && Number(m[1]) === uid;
    });
}
/* utime + stime in clock ticks, from /proc/.../stat (fields after the ')' of comm). */
function ticks(file) {
    const s = read(file);
    if (s === null) return null;
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return Number(f[11]) + Number(f[12]);
}
function systemTicks() {
    const s = read('/proc/stat');
    if (s === null) return null;
    const f = s.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const total = f.reduce((a, b) => a + b, 0);
    return { total: total, idle: f[3] + (f[4] || 0) };
}
function cpuCount() {
    const s = read('/proc/stat');
    return s === null ? 0 : s.split('\n').filter((l) => /^cpu\d+ /.test(l)).length;
}

/* ---- gpu ----------------------------------------------------------------------------------- */

const FREQ_FILES = ['gt_cur_freq_mhz', 'gt_act_freq_mhz', 'gt_min_freq_mhz', 'gt_max_freq_mhz',
    'gt_boost_freq_mhz', 'gt_RP0_freq_mhz', 'gt_RP1_freq_mhz', 'gt_RPn_freq_mhz'];
const GL_LIB = /(_dri\.so|libEGL|libGLES|libgbm|libdrm|libwayland|libGL\.|libmali|libIMG|libva|i965|iris)/;

function groups() {
    const g = {};
    (read('/etc/group') || '').split('\n').forEach((l) => {
        const f = l.split(':');
        if (f.length >= 3) g[f[2]] = f[0];
    });
    return g;
}
function passwd() {
    const u = {};
    (read('/etc/passwd') || '').split('\n').forEach((l) => {
        const f = l.split(':');
        if (f.length >= 3) u[f[2]] = f[0];
    });
    return u;
}

function cmdGpu() {
    const res = { kernel: readTrim('/proc/version'), drm: [], freq: null, freqCard: null, processes: [], devDri: [] };
    const base = '/sys/class/drm';
    ls(base).sort().forEach((n) => {
        const d = path.join(base, n);
        try { if (!fs.statSync(d).isDirectory()) return; } catch (e) { return; }
        const e = { name: n };
        const drv = readlink(path.join(d, 'device', 'driver'));
        if (drv) e.driver = path.basename(drv);
        ['vendor', 'device', 'subsystem_vendor', 'subsystem_device'].forEach((k) => {
            const v = readTrim(path.join(d, 'device', k));
            if (v !== null && /^card\d+$|^renderD\d+$/.test(n)) e[k] = v;
        });
        const st = readTrim(path.join(d, 'status'));
        if (st !== null) {
            e.status = st;
            e.enabled = readTrim(path.join(d, 'enabled'));
            const modes = read(path.join(d, 'modes'));
            e.modes = modes ? modes.trim().split('\n').filter((m, i, all) => m && all.indexOf(m) === i) : [];
        }
        res.drm.push(e);
        if (!res.freq && /^card\d+$/.test(n) && read(path.join(d, 'gt_act_freq_mhz')) !== null) {
            res.freqCard = n;
            res.freq = {};
            FREQ_FILES.forEach((f) => { res.freq[f] = readTrim(path.join(d, f)); });
        }
    });
    const people = [{ name: 'HmiMain3D', pids: byComm('HmiMain3D') }, { name: 'mgu-render', pids: byComm('mgu-render') }];
    people.forEach((p) => p.pids.forEach((pid) => {
        const libs = [];
        (read('/proc/' + pid + '/maps') || '').split('\n').forEach((l) => {
            const i = l.indexOf('/');
            if (i < 0) return;
            const f = l.slice(i).trim();
            if (GL_LIB.test(path.basename(f)) && libs.indexOf(f) < 0) libs.push(f);
        });
        const dri = [];
        ls('/proc/' + pid + '/fd').forEach((fd) => {
            const t = readlink('/proc/' + pid + '/fd/' + fd);
            if (t && t.indexOf('/dev/dri/') === 0) dri.push(fd + ' -> ' + t);
        });
        res.processes.push({ name: p.name, pid: pid, libraries: libs.sort(), driFds: dri });
    }));
    const gr = groups(), pw = passwd();
    ls('/dev/dri').sort().forEach((n) => {
        try {
            const s = fs.lstatSync('/dev/dri/' + n);
            const e = { name: n, mode: '0' + (s.mode & 0o7777).toString(8), owner: (pw[s.uid] || s.uid) + ':' + (gr[s.gid] || s.gid) };
            if (s.isCharacterDevice()) e.rdev = Math.floor(s.rdev / 256) + ':' + (s.rdev % 256);
            if (s.isSymbolicLink()) e.link = readlink('/dev/dri/' + n);
            if (s.isDirectory()) e.entries = ls('/dev/dri/' + n).map((x) => x + ' -> ' + (readlink('/dev/dri/' + n + '/' + x) || '?'));
            res.devDri.push(e);
        } catch (e) { /* gone */ }
    });

    const out = ['== gpu'];
    if (res.kernel) out.push('kernel: ' + res.kernel);
    out.push('/sys/class/drm:');
    if (!res.drm.length) out.push('  (none)');
    res.drm.forEach((e) => {
        let s = '  ' + pad(e.name, 22);
        if (e.driver) s += ' driver ' + e.driver;
        if (e.vendor) s += ' vendor ' + e.vendor + ' device ' + e.device;
        if (e.subsystem_vendor) s += ' subsystem ' + e.subsystem_vendor + ':' + e.subsystem_device;
        if (e.status !== undefined) s += ' ' + e.status + (e.enabled ? ' ' + e.enabled : '') + (e.modes.length ? ' modes ' + e.modes.join(' ') : '');
        out.push(s);
    });
    if (res.freq) {
        out.push('i915 frequencies (' + res.freqCard + ', MHz): ' + FREQ_FILES.map((f) => f.replace(/^gt_|_freq_mhz$/g, '') + ' ' + res.freq[f]).join(', '));
    } else {
        out.push('i915 frequencies: not found');
    }
    people.forEach((p) => { if (!p.pids.length) out.push(p.name + ': not running'); });
    res.processes.forEach((p) => {
        out.push(p.name + ' (pid ' + p.pid + ') GL libraries:');
        if (!p.libraries.length) out.push('  (none mapped)');
        p.libraries.forEach((l) => out.push('  ' + l));
        out.push('  /dev/dri open: ' + (p.driFds.length ? p.driFds.join(', ') : 'none'));
    });
    out.push('/dev/dri:');
    if (!res.devDri.length) out.push('  (none)');
    res.devDri.forEach((e) => out.push('  ' + pad(e.name, 14) + ' ' + e.mode + ' ' + e.owner + (e.rdev ? ' ' + e.rdev : '') +
        (e.link ? ' -> ' + e.link : '') + (e.entries ? ' [' + e.entries.join(', ') + ']' : '')));
    console.log(out.join('\n') + '\n');
    return res;
}

/* ---- cpu ----------------------------------------------------------------------------------- */

function threadTicks(pid) {
    const out = {};
    ls('/proc/' + pid + '/task').forEach((tid) => {
        const t = ticks('/proc/' + pid + '/task/' + tid + '/stat');
        if (t !== null) out[tid] = { ticks: t, name: comm(pid, tid) || '?' };
    });
    return out;
}
function freqCard() {
    const c = ls('/sys/class/drm').filter((n) => /^card\d+$/.test(n)).sort()
        .find((n) => read('/sys/class/drm/' + n + '/gt_act_freq_mhz') !== null);
    return c ? '/sys/class/drm/' + c : null;
}

/* the cores' clock policy (intel_pstate / cpufreq), a line; null without cpufreq */
const CPU_SYS = '/sys/devices/system/cpu';
function cpuPolicy() {
    const gov = readTrim(CPU_SYS + '/cpu0/cpufreq/scaling_governor');
    if (gov === null) return null;
    const v = (f) => { const x = readTrim(CPU_SYS + '/' + f); return x === null ? '-' : x; };
    return 'governor ' + gov + ', max ' + Math.round(Number(v('cpu0/cpufreq/cpuinfo_max_freq')) / 1000) + ' MHz, max_perf_pct ' +
        v('intel_pstate/max_perf_pct') + ', min_perf_pct ' + v('intel_pstate/min_perf_pct') + ', no_turbo ' + v('intel_pstate/no_turbo');
}
/* the fastest core's clock now (MHz), or null */
function cpuMhz(ncpu) {
    let best = null;
    for (let i = 0; i < ncpu; i++) {
        const f = readTrim(CPU_SYS + '/cpu' + i + '/cpufreq/scaling_cur_freq');
        if (f !== null && (best === null || Number(f) > best)) best = Number(f);
    }
    return best === null ? null : Math.round(best / 1000);
}

function cmdCpu(seconds, gpuFreq) {
    const ncpu = cpuCount();
    const card = gpuFreq ? freqCard() : null;
    const groupsNow = () => ({
        'mgu-render': byComm('mgu-render'),
        HmiMain3D: byComm('HmiMain3D'),
        store: storePids()
    });
    const found = groupsNow();
    const policy = cpuPolicy(), cpuf = cpuMhz(ncpu) !== null;
    const res = { seconds: seconds, cpus: ncpu, clkTck: CLK_TCK, pids: found, gpuFreqFile: card ? card + '/gt_act_freq_mhz' : null, cpuPolicy: policy, samples: [], summary: {} };
    const head = 'pids: ' + Object.keys(found).map((k) => k + ' ' + (found[k].length ? found[k].join(',') : '-')).join(', ') +
        '; ' + ncpu + ' cpus; process % is of one core, system % of all cores';
    console.log('== cpu, ' + seconds + ' s\n' + head);
    if (gpuFreq && !card) console.log('gpu frequency: no gt_act_freq_mhz found');
    console.log('cpu clock: ' + (policy || 'no cpufreq'));
    const snap = () => {
        const s = { t: process.hrtime(), sys: systemTicks(), groups: {}, threads: {} };
        Object.keys(found).forEach((k) => {
            s.groups[k] = found[k].reduce((a, p) => {
                const t = ticks('/proc/' + p + '/stat');
                return t === null ? a : a + t;
            }, 0);
            if (k !== 'store') found[k].forEach((p) => { s.threads[k + ':' + p] = threadTicks(p); });
        });
        return s;
    };
    const cols = ['mgu-render', 'HmiMain3D', 'store'];
    console.log(['  s', 'system%', 'mgu-render%', 'HmiMain3D%', 'store%'].concat(card ? ['gpu MHz'] : [], cpuf ? ['cpu MHz'] : []).map((c, i) => lpad(c, i ? 12 : 3)).join(''));
    return new Promise((resolve) => {
        let prev = snap(), n = 0;
        const step = () => {
            const cur = snap();
            const dt = (cur.t[0] - prev.t[0]) + (cur.t[1] - prev.t[1]) / 1e9;
            const row = { second: ++n, groups: {}, threads: {} };
            if (cur.sys && prev.sys) {
                const dTot = cur.sys.total - prev.sys.total, dIdle = cur.sys.idle - prev.sys.idle;
                row.system = dTot > 0 ? Math.round(1000 * (1 - dIdle / dTot)) / 10 : null;
            }
            cols.forEach((k) => {
                row.groups[k] = found[k].length ? Math.round(1000 * (cur.groups[k] - prev.groups[k]) / CLK_TCK / dt) / 10 : null;
            });
            Object.keys(cur.threads).forEach((key) => {
                const a = cur.threads[key], b = prev.threads[key] || {};
                Object.keys(a).forEach((tid) => {
                    if (!b[tid]) return;
                    row.threads[key + ':' + tid] = { name: a[tid].name, pct: Math.round(1000 * (a[tid].ticks - b[tid].ticks) / CLK_TCK / dt) / 10 };
                });
            });
            if (card) {
                const f = readTrim(card + '/gt_act_freq_mhz');
                row.gpuMhz = f === null ? null : Number(f);
            }
            if (cpuf) row.cpuMhz = cpuMhz(ncpu);
            res.samples.push(row);
            const cell = (v) => lpad(v === null || v === undefined ? '-' : v.toFixed(1), 12);
            console.log([lpad(n, 3), cell(row.system)].concat(cols.map((k) => cell(row.groups[k])))
                .concat(card ? [lpad(row.gpuMhz === null ? '-' : row.gpuMhz, 12)] : [], cpuf ? [lpad(row.cpuMhz === null ? '-' : row.cpuMhz, 12)] : []).join(''));
            prev = cur;
            if (n < seconds) setTimeout(step, 1000);
            else finish();
        };
        const stats = (vals) => {
            vals = vals.filter((v) => typeof v === 'number');
            if (!vals.length) return null;
            return { mean: Math.round(10 * vals.reduce((a, b) => a + b, 0) / vals.length) / 10, max: Math.max.apply(null, vals) };
        };
        const finish = () => {
            res.summary.system = stats(res.samples.map((r) => r.system));
            cols.forEach((k) => { res.summary[k] = stats(res.samples.map((r) => r.groups[k])); });
            if (card) res.summary.gpuMhz = stats(res.samples.map((r) => r.gpuMhz));
            if (cpuf) res.summary.cpuMhz = stats(res.samples.map((r) => r.cpuMhz));
            const th = {};
            res.samples.forEach((r) => Object.keys(r.threads).forEach((key) => {
                (th[key] = th[key] || { name: r.threads[key].name, vals: [] }).vals.push(r.threads[key].pct);
            }));
            res.summary.threads = Object.keys(th).map((key) => {
                const s = stats(th[key].vals);
                return { key: key, name: th[key].name, mean: s.mean, max: s.max };
            }).sort((a, b) => b.mean - a.mean);
            const fmt = (s) => s ? 'mean ' + s.mean.toFixed(1) + ' max ' + s.max.toFixed(1) : '-';
            const out = ['summary:', '  system      ' + fmt(res.summary.system)];
            cols.forEach((k) => out.push('  ' + pad(k, 11) + ' ' + fmt(res.summary[k])));
            if (card) out.push('  gpu MHz     ' + (res.summary.gpuMhz ? 'mean ' + res.summary.gpuMhz.mean + ' max ' + res.summary.gpuMhz.max : '-'));
            if (cpuf) out.push('  cpu MHz     ' + (res.summary.cpuMhz ? 'mean ' + res.summary.cpuMhz.mean + ' max ' + res.summary.cpuMhz.max : '-'));
            const busy = res.summary.threads.filter((t) => t.max >= 1);
            if (busy.length) {
                out.push('threads at 1% or more (process:pid:tid name):');
                busy.forEach((t) => out.push('  ' + pad(t.key, 28) + ' ' + pad(t.name, 16) + ' ' + fmt(t)));
            }
            console.log(out.join('\n') + '\n');
            resolve(res);
        };
        setTimeout(step, 1000);
    });
}

/* ---- command line -------------------------------------------------------------------------- */

const USAGE = 'usage: node probe.js globals [display...] | gpu | cpu [seconds] [--gpu-freq] | all   [--json <file>]';

function main(argv) {
    let json = null, gpuFreq = false;
    const args = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--json') {
            if (i + 1 >= argv.length) { console.error(USAGE); return Promise.resolve(2); }
            json = argv[++i];
        } else if (argv[i] === '--gpu-freq') gpuFreq = true;
        else args.push(argv[i]);
    }
    const cmd = args.shift();
    let run;
    if (cmd === 'globals') run = cmdGlobals(args).then((r) => ({ globals: r }));
    else if (cmd === 'gpu' && !args.length) run = Promise.resolve({ gpu: cmdGpu() });
    else if (cmd === 'cpu' && args.length <= 1 && (!args.length || /^\d+$/.test(args[0]))) {
        run = cmdCpu(args.length ? Math.max(1, Number(args[0])) : 10, gpuFreq).then((r) => ({ cpu: r }));
    } else if (cmd === 'all' && !args.length) run = cmdGlobals([]).then((g) => ({ globals: g, gpu: cmdGpu() }));
    else { console.error(USAGE); return Promise.resolve(2); }
    return run.then((r) => {
        r.at = new Date().toISOString();
        if (json) {
            fs.writeFileSync(json, JSON.stringify(r, null, 2) + '\n');
            console.log('wrote ' + json);
        }
        return 0;
    });
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
        (e) => { console.error('probe: ' + (e && e.stack || e)); process.exitCode = 1; });
}

module.exports = { probeDisplay: probeDisplay, fourcc: fourcc, main: main };
