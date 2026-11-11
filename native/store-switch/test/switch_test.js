'use strict';
// node native/store-switch/test/switch_test.js
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-switch-'));
const file = path.join(dir, 'mgu-updater', 'updater.local.conf');
const run = (arg) => cp.execFileSync('node', [path.join(__dirname, '..', 'switch.js'), arg], { env: Object.assign({}, process.env, { MGU_UPDATER_CONF: file }), encoding: 'utf8' });
const last = (out) => JSON.parse(out.trim().split('\n').pop());
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else console.log('ok   ' + m); };

ok(last(run('on')).reboot && fs.readFileSync(file, 'utf8') === 'builtin_repo = TheoneLT83/mgu-store\n', 'on: the line written, a start asked for');
ok((fs.statSync(file).mode & 0o777) === 0o600, 'root\'s alone (0600)');
ok(last(run('on')).status && !last(run('on')).reboot, 'on again: nothing changed, no start asked for');
fs.writeFileSync(file, 'proxy = socks5://h:1\nbuiltin_repo = someone/else\n');
run('on');
ok(fs.readFileSync(file, 'utf8') === 'proxy = socks5://h:1\nbuiltin_repo = TheoneLT83/mgu-store\n', 'on: another source replaced, the proxy kept');
ok(last(run('off')).reboot && fs.readFileSync(file, 'utf8') === 'proxy = socks5://h:1\n', 'off: the line taken out, the rest kept');
ok(last(run('off')).status, 'off again: nothing to do');
let threw = false; try { run('x'); } catch (e) { threw = e.status === 2; }
ok(threw, 'anything else: exit 2');
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? fails + ' failed' : 'all ok');
process.exit(fails ? 1 : 0);
