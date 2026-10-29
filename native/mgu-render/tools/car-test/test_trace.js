'use strict';
/* trace.js against a made-up drag: frames every 40 ms, each built 5 ms after its TICK, drawn 10 ms after it
 * arrives, shown 14 ms after its commit; one frame replaced before it was drawn. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { read, lastRun, analyse, report } = require('./trace.js');

const R = [], S = [];
const r = (us, step, n) => R.push(`${us} R ${step} ${n} robertn_store`);
const s = (us, step, n, kind) => S.push(`${us} S ${step} ${n} ${kind || ''}`);
r(500, 'frame-rx', 1);                       // an earlier connection: left out
for (let n = 1; n <= 10; n++) {
    const t = 1000000 + n * 40000;
    r(t - 6000, 'tick', n); s(t - 5800, 'tick', n);
    r(t - 9000, 'touch-in', n); r(t - 8900, 'touch-fwd', n); s(t - 8000, 'touch', n, n % 5 === 1 ? 'down' : 'move');
    if (n % 5 === 0) { s(t + 2000, 'settle-start', n); s(t + 3500, 'settle-end', n); }
    s(t - 5000, 'build-start', n, 'drag'); s(t - 1000, 'build-end', n, 'drag'); s(t, 'send', n);
    r(t + 300, 'frame-rx', n);
    if (n === 5) continue;                   // a newer frame drawn in its place
    r(t + 10300, 'draw-start', n); r(t + 11300, 'draw-end', n); r(t + 11500, 'commit', n); r(t + 25500, 'callback', n);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
fs.writeFileSync(path.join(dir, 'r'), R.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 's'), S.join('\n') + '\n');
const render = lastRun(read(path.join(dir, 'r'), 'R').filter((e) => e.rest === 'robertn_store'), 'frame-rx');
const a = analyse(render, lastRun(read(path.join(dir, 's'), 'S'), 'send'));
const med = (name) => { const st = a.steps.find((x) => x[0] === name)[1].slice().sort((x, y) => x - y); return st[Math.floor(st.length / 2)]; };
assert.strictEqual(a.sent, 10);
assert.strictEqual(a.notDrawn, 1);
assert.deepStrictEqual(a.trig, { tick: 10, touch: 0, none: 0 }, 'each build after its TICK, the later of TICK and touch');
assert.strictEqual(med('wait: trigger to build'), 0.8);
assert.strictEqual(med('build'), 4);
assert.strictEqual(med('send to frame-rx (socket)'), 0.3);
assert.strictEqual(med('frame-rx to draw-start'), 10);
assert.strictEqual(med('commit to HMI callback'), 14);
assert.strictEqual(med('frame to next frame (send to send)'), 40);
assert.strictEqual(a.offClock, 0);
const work = Object.fromEntries(a.work.map(([k, xs]) => [k, xs]));
assert.deepStrictEqual([a.touches, work['a touch\'s first drag frame'], work['release (settle)']], [2, [4, 4], [1.5, 1.5]],
    'per touch: its first drag frame, the release');
assert(/10 frames sent in 0\.4 s/.test(report(a)), report(a));
fs.rmSync(dir, { recursive: true, force: true });
console.log('trace: all checks pass');
