'use strict';
// multitouch.js against a fake agent and file system: node native/carplay-multitouch/test/test.js
var assert = require('assert'), path = require('path');
var createTool = require('../multitouch.js').createTool;

function fixture(opts) {
    opts = opts || {};
    var files = {}, calls = [], logs = [], spawned = [], killed = [], timers = [];
    if (opts.installed) files['/p/install.json'] = JSON.stringify({ package: 'idrive7-carplay-multitouch', version: opts.installed });
    var agent = {
        preflight: function () { calls.push('preflight'); if (opts.unsupported) throw Error('Unsupported factory CarPlay executable. Nothing installed.'); },
        install: function () {
            calls.push('install');
            if (opts.volts && opts.volts.length && opts.volts.shift() < 13000) throw Error('Stable supply of at least 13.0 V is required for installation/activation');
            files['/p/install.json'] = JSON.stringify({ package: 'idrive7-carplay-multitouch', version: '0.1.0' });
            return { state: 'installed-for-next-boot' };
        },
        uninstall: function () { calls.push('uninstall'); if (opts.uninstallFails) throw Error('Drop-in changed'); delete files['/p/install.json']; return { state: 'removed-for-next-boot' }; },
        status: function () { calls.push('status'); return { installed: true }; }
    };
    var fs = {
        readFileSync: function (p) { if (files[p] === undefined) { var e = Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
        writeFileSync: function (p, d) { files[p] = String(d); },
        unlinkSync: function (p) { if (files[p] === undefined) throw Error('ENOENT'); delete files[p]; },
        openSync: function () { return 9; }, closeSync: function () {}
    };
    var tool = createTool({ agent: agent, fs: fs, log: function (l) { logs.push(l); }, patchRoot: '/p', toolRoot: '/t',
        spawn: function (cmd, args) { spawned.push(args); return { pid: 4242, unref: function () {} }; },
        process: { pid: 1, execPath: 'node', kill: function (pid) { killed.push(pid); } },
        setTimeout: function (fn) { timers.push(fn); } });
    return { tool: tool, files: files, calls: calls, logs: logs, spawned: spawned, killed: killed, timers: timers };
}
var n = 0;
function test(name, fn) { fn(); n++; }

test('a matching car: the patch installed for the next start', function () {
    var f = fixture(), r = f.tool.run('install');
    assert.strictEqual(r.state, 'installed-for-next-boot');
    assert.deepStrictEqual(f.calls, ['preflight', 'install']);
    assert(/next start/.test(f.logs[0]));
});
test('another CarPlay build: nothing changed, the install stands', function () {
    var f = fixture({ unsupported: true }), r = f.tool.run('install');
    assert.strictEqual(r.state, 'unsupported');
    assert.deepStrictEqual(f.calls, ['preflight']);
    assert(/nothing changed/.test(f.logs[0]));
});
test('engine off: a retry loop in the background, which installs once the voltage is there', function () {
    var f = fixture({ volts: [12100, 12200, 14000] }), r = f.tool.run('install');
    assert.strictEqual(r.state, 'waiting');
    assert.strictEqual(f.spawned.length, 1);
    assert.strictEqual(path.basename(f.spawned[0][0]), 'multitouch.js');
    assert.strictEqual(f.spawned[0][1], 'retry');
    assert.strictEqual(f.files['/t/retry.pid'], '4242\n');
    var done = null;
    f.tool.retry(function (e, res) { done = [e, res]; });
    f.timers.shift()();          // 12200: again
    assert.strictEqual(done, null);
    f.timers.shift()();          // 14000: installed
    assert.strictEqual(done[0], null);
    assert.strictEqual(done[1].state, 'installed-for-next-boot');
    assert.strictEqual(f.files['/t/retry.pid'], undefined);
});
test('an installed patch of another version is replaced', function () {
    var f = fixture({ installed: '0.0.9' });
    f.tool.run('install');
    assert.deepStrictEqual(f.calls, ['uninstall', 'preflight', 'install']);
});
test('uninstall: the patch out and a waiting retry stopped', function () {
    var f = fixture({ installed: '0.1.0' });
    f.files['/t/retry.pid'] = '777\n';
    var r = f.tool.run('uninstall');
    assert.strictEqual(r.state, 'removed-for-next-boot');
    assert.deepStrictEqual(f.killed, [777]);
    assert.strictEqual(f.files['/p/install.json'], undefined);
});
test('uninstall without a patch: nothing to do', function () {
    var f = fixture();
    assert.strictEqual(f.tool.run('uninstall').state, 'none');
    assert.deepStrictEqual(f.calls, []);
});
test('uninstall that fails throws (mgu-deploy then keeps the tool)', function () {
    var f = fixture({ installed: '0.1.0', uninstallFails: true });
    assert.throws(function () { f.tool.run('uninstall'); }, /Drop-in changed/);
});
test('a patch installed by another installer (not ours) is left alone', function () {
    var f = fixture();
    f.files['/p/install.json'] = JSON.stringify({ package: 'something-else', version: '1.0.0' });
    assert.strictEqual(f.tool.run('uninstall').state, 'none');
});
console.log('carplay-multitouch: ' + n + ' tests passed');
