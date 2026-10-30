'use strict';
/**
 * render_check.js - whether the installed mgu-render works (the deploy tool's "check", component.json). Node 8, as
 * root.
 *
 *   node render_check.js
 *
 * A client connects to mgu-render's socket (which starts mgu-render.service when it does not run), says HELLO in the
 * native dialect and must get X_READY and READY with a screen size. After a settle time the service must still be
 * active with its NRestarts unchanged, and a second connection must get READY again. The check draws nothing: it
 * never sends PLACE or SHOW. Exit 0 when it works, 1 with the reason on stderr.
 */
const net = require('net');
const cp = require('child_process');

const SOCKET = process.env.MGU_RENDER_CHECK_SOCKET || '/run/mgu-render/render.sock';
const SERVICE = 'mgu-render.service';
const ANSWER_MS = Number(process.env.MGU_RENDER_CHECK_ANSWER_MS || 90000);
const SETTLE_MS = Number(process.env.MGU_RENDER_CHECK_SETTLE_MS || 20000);
const SYSTEMCTL = process.env.MGU_RENDER_CHECK_SYSTEMCTL || 'systemctl';
const HELLO = 1;
const READY = 101;
const X_READY = 0x4d520101;

/* One connection: HELLO, then X_READY and READY. Resolves { screen: [w, h] }. */
function hello() {
    return new Promise((resolve, reject) => {
        const s = net.connect(SOCKET);
        let buf = Buffer.alloc(0);
        let native = false;
        const done = (err, v) => {
            clearTimeout(timer);
            s.destroy();
            if (err) {
                reject(err);
            } else {
                resolve(v);
            }
        };
        const timer = setTimeout(() => done(new Error(`no READY within ${Math.round(ANSWER_MS / 1000)}s`)), ANSWER_MS);
        s.on('connect', () => {
            const id = Buffer.from('mgu-render-check\0proto=mgu-render/1');
            const m = Buffer.alloc(8 + id.length + ((4 - (id.length & 3)) & 3));
            m.writeUInt32LE(HELLO, 0);
            m.writeUInt32LE(m.length - 8, 4);
            id.copy(m, 8);
            s.write(m);
        });
        s.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 8) {
                const type = buf.readUInt32LE(0);
                const len = buf.readUInt32LE(4);
                if (buf.length < 8 + len) {
                    return;
                }
                const p = buf.slice(8, 8 + len);
                buf = buf.slice(8 + len);
                if (type === X_READY) {
                    native = true;
                } else if (type === READY) {
                    if (len < 12) {
                        return done(new Error('READY is too short'));
                    }
                    const w = p.readUInt32LE(4);
                    const h = p.readUInt32LE(8);
                    if (!native) {
                        return done(new Error('READY came without X_READY: the socket is not mgu-render\'s'));
                    }
                    if (!w || !h) {
                        return done(new Error(`READY gives no screen (${w}x${h})`));
                    }
                    return done(null, { screen: [w, h] });
                }
            }
        });
        s.on('error', (e) => done(new Error(`${SOCKET}: ${e.code || e.message}`)));
        s.on('close', () => done(new Error('the renderer closed the connection before READY')));
    });
}

function service() {
    const r = cp.spawnSync(SYSTEMCTL, ['show', '-p', 'ActiveState', '-p', 'NRestarts', SERVICE], { encoding: 'utf8' });
    const m = {};
    String(r.stdout || '').split('\n').forEach((l) => {
        const i = l.indexOf('=');
        if (i > 0) {
            m[l.slice(0, i)] = l.slice(i + 1).trim();
        }
    });
    return { active: m.ActiveState || 'unknown', restarts: m.NRestarts === undefined ? null : Number(m.NRestarts) };
}

function main() {
    return hello().then((r) => {
        const first = service();
        console.log(`READY: screen ${r.screen.join('x')}; ${SERVICE} ${first.active}`);
        return new Promise((resolve) => setTimeout(resolve, SETTLE_MS)).then(() => {
            const now = service();
            if (now.active !== 'active' || now.restarts !== first.restarts) {
                throw new Error(`${SERVICE} did not stay up (ActiveState=${now.active}, NRestarts ${first.restarts} -> ${now.restarts})`);
            }
            return hello();
        });
    }).then(() => console.log(`${SERVICE} stayed up and answers`));
}

main().then(() => process.exit(0), (e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
});
