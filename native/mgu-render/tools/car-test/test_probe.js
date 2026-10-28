#!/usr/bin/env node
'use strict';
/*
 * Tests probe.js against a fake Wayland compositor on a Unix socket (Node 8 or newer):
 *   node test_probe.js
 * The fake serves wl_compositor, wl_shm, wl_drm v2 and zwp_linux_dmabuf_v1 v4, sends its events
 * in small pieces, and checks what the probe binds. Further cases: wl_display.error, a compositor
 * that never answers, a missing socket, and the command line with --json.
 */
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const probe = require('./probe.js');

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function str(s) {
    const body = Buffer.from(s + '\0');
    return Buffer.concat([u32(body.length), body, Buffer.alloc((4 - body.length % 4) % 4)]);
}
function msg(id, op, args) {
    const body = Buffer.concat(args || []);
    const h = Buffer.alloc(8);
    h.writeUInt32LE(id, 0);
    h.writeUInt32LE(((8 + body.length) << 16 | op) >>> 0, 4);
    return Buffer.concat([h, body]);
}
function fcc(s) { return s.charCodeAt(0) | s.charCodeAt(1) << 8 | s.charCodeAt(2) << 16 | s.charCodeAt(3) << 24; }

const GLOBALS = [
    { name: 1, iface: 'wl_compositor', version: 4 },
    { name: 2, iface: 'wl_shm', version: 1 },
    { name: 3, iface: 'wl_drm', version: 2 },
    { name: 4, iface: 'zwp_linux_dmabuf_v1', version: 4 },
    { name: 5, iface: 'ivi_application', version: 1 }
];

/* mode: 'ok' | 'error' | 'silent' */
function fakeServer(file, mode) {
    const seen = { binds: [], syncs: 0 };
    const server = net.createServer((c) => {
        const objs = { 1: 'wl_display' };
        let buf = Buffer.alloc(0);
        const send = (b) => {
            // in 5-byte pieces, so the probe has to put messages back together
            for (let i = 0; i < b.length; i += 5) c.write(b.slice(i, i + 5));
        };
        c.on('data', (d) => {
            if (mode === 'silent') return;
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 8) {
                const id = buf.readUInt32LE(0), w = buf.readUInt32LE(4), size = w >>> 16, op = w & 0xffff;
                if (buf.length < size) break;
                const body = buf.slice(8, size);
                buf = buf.slice(size);
                if (objs[id] === 'wl_display' && op === 1) {
                    const reg = body.readUInt32LE(0);
                    objs[reg] = 'wl_registry';
                    if (mode === 'error') {
                        send(msg(1, 0, [u32(1), u32(1), str('invalid method')]));
                        continue;
                    }
                    GLOBALS.forEach((g) => send(msg(reg, 0, [u32(g.name), str(g.iface), u32(g.version)])));
                } else if (objs[id] === 'wl_display' && op === 0) {
                    const cb = body.readUInt32LE(0);
                    seen.syncs++;
                    send(msg(cb, 0, [u32(100 + seen.syncs)]));
                    send(msg(1, 1, [u32(cb)]));
                } else if (objs[id] === 'wl_registry' && op === 0) {
                    const name = body.readUInt32LE(0), len = body.readUInt32LE(4);
                    const iface = body.toString('utf8', 8, 8 + len - 1);
                    const off = 8 + len + (4 - len % 4) % 4;
                    const version = body.readUInt32LE(off), nid = body.readUInt32LE(off + 4);
                    objs[nid] = iface;
                    seen.binds.push({ name: name, iface: iface, version: version, id: nid });
                    if (iface === 'wl_shm') [0, 1, fcc('NV12')].forEach((f) => send(msg(nid, 0, [u32(f)])));
                    if (iface === 'wl_drm') {
                        send(msg(nid, 0, [str('/dev/dri/card0')]));
                        ['AR24', 'XR24'].forEach((f) => send(msg(nid, 1, [u32(fcc(f))])));
                        send(msg(nid, 3, [u32(1)]));
                    }
                    if (iface === 'zwp_linux_dmabuf_v1') {
                        send(msg(nid, 0, [u32(fcc('AR24'))]));
                        send(msg(nid, 1, [u32(fcc('AR24')), u32(0), u32(0)]));
                        send(msg(nid, 1, [u32(fcc('AR24')), u32(0x01000000), u32(2)]));
                        send(msg(nid, 1, [u32(fcc('XR24')), u32(0x00ffffff), u32(0xffffffff)]));
                    }
                }
            }
        });
        c.on('error', () => {});
    });
    return new Promise((resolve) => server.listen(file, () => resolve({ server: server, seen: seen })));
}

function sock(name) { return path.join(os.tmpdir(), 'probe-test-' + process.pid + '-' + name); }

function caseOk() {
    const file = sock('ok');
    return fakeServer(file, 'ok').then((f) => probe.probeDisplay(file, 3000).then((r) => {
        f.server.close();
        assert.strictEqual(r.ok, true, r.error);
        assert.deepStrictEqual(r.globals.map((g) => g.interface), GLOBALS.map((g) => g.iface));
        assert.deepStrictEqual(f.seen.binds.map((b) => b.iface + ' v' + b.version),
            ['wl_shm v1', 'wl_drm v2', 'zwp_linux_dmabuf_v1 v3']);
        assert.deepStrictEqual(r.shm.formats.map(probe.fourcc), ['ARGB8888', 'XRGB8888', 'NV12']);
        assert.strictEqual(r.drm.device, '/dev/dri/card0');
        assert.strictEqual(r.drm.capabilities, 1);
        assert.strictEqual(r.drm.prime, true);
        assert.deepStrictEqual(r.drm.formats.map(probe.fourcc), ['AR24', 'XR24']);
        assert.strictEqual(r.dmabuf.version, 3);
        assert.deepStrictEqual(r.dmabuf.modifiers, [
            { format: fcc('AR24'), modifier: '0x0000000000000000' },
            { format: fcc('AR24'), modifier: '0x0100000000000002' },
            { format: fcc('XR24'), modifier: '0x00ffffffffffffff' }
        ]);
        // the first callback's delete_id comes before the probe stops at the second one's done
        assert.deepStrictEqual(r.deleted, [3], 'delete_id of the first callback');
        console.log('ok: globals listed, wl_shm/wl_drm/zwp_linux_dmabuf_v1 bound (dmabuf at v3) and parsed');
    }));
}

function caseError() {
    const file = sock('err');
    return fakeServer(file, 'error').then((f) => probe.probeDisplay(file, 3000).then((r) => {
        f.server.close();
        assert.strictEqual(r.ok, false);
        assert.ok(/wl_display\.error: object 1 \(wl_display\) code 1: invalid method/.test(r.error), r.error);
        console.log('ok: wl_display.error reported: ' + r.error);
    }));
}

function caseSilent() {
    const file = sock('silent');
    return fakeServer(file, 'silent').then((f) => {
        const t0 = Date.now();
        return probe.probeDisplay(file, 300).then((r) => {
            f.server.close();
            assert.strictEqual(r.ok, false);
            assert.ok(/timed out/.test(r.error), r.error);
            assert.ok(Date.now() - t0 < 2000);
            console.log('ok: silent compositor: ' + r.error);
        });
    });
}

function caseMissing() {
    return probe.probeDisplay(sock('missing'), 3000).then((r) => {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.error, 'ENOENT');
        console.log('ok: missing socket: ' + r.error);
    });
}

function caseCli() {
    const file = sock('cli');
    const json = sock('cli.json');
    return fakeServer(file, 'ok').then((f) => new Promise((resolve, reject) => {
        cp.execFile(process.execPath, [path.join(__dirname, 'probe.js'), 'globals', file, '--json', json], (err, stdout) => {
            f.server.close();
            if (err) return reject(err);
            const out = JSON.parse(fs.readFileSync(json, 'utf8'));
            fs.unlinkSync(json);
            assert.strictEqual(out.globals[0].drm.prime, true);
            assert.ok(/wl_drm v2: device \/dev\/dri\/card0, capabilities 0x1 PRIME/.test(stdout));
            assert.ok(/AR24 +LINEAR, I915_Y_TILED/.test(stdout));
            console.log('ok: command line text and --json\n--- probe output ---\n' + stdout.trim() + '\n---');
            resolve();
        });
    }));
}

[caseOk, caseError, caseSilent, caseMissing, caseCli].reduce((p, c) => p.then(c), Promise.resolve())
    .then(() => console.log('all probe tests passed'), (e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exitCode = 1; });
