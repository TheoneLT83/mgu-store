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
// a car whose updater saved its sources: the built-in one's repo is what it reads
const src = path.join(dir, 'mgu-updater', 'sources.json');
const saved = (repo) => JSON.stringify({ schema: 1, sources: [{ id: 'mgu-store', type: 'github', repo, builtin: true },
    { id: 'idrive-apps', type: 'github', repo: 'robertnisipeanu/idrive-apps' }] }, null, 2) + '\n';
const repoOf = () => JSON.parse(fs.readFileSync(src, 'utf8')).sources[0].repo;
fs.writeFileSync(src, saved('robertnisipeanu/mgu-store'));
ok(last(run('on')).reboot && repoOf() === 'TheoneLT83/mgu-store', 'on: the saved built-in source reads TheoneLT83/mgu-store, a start asked for');
ok(JSON.parse(fs.readFileSync(src, 'utf8')).sources[1].repo === 'robertnisipeanu/idrive-apps', 'on: the other sources kept');
ok((fs.statSync(src).mode & 0o777) === 0o600, 'sources.json root\'s alone');
ok(last(run('on')).status, 'on again: nothing changed');
ok(last(run('off')).reboot && repoOf() === 'robertnisipeanu/mgu-store', 'off: the saved source back on the repo it read before');
ok(!fs.existsSync(path.join(dir, 'mgu-updater', 'store-switch.json')), 'off: the record gone');
fs.writeFileSync(src, saved('TheoneLT83/mgu-store'));
run('on'); run('off');
ok(repoOf() === 'TheoneLT83/mgu-store', 'already TheoneLT83/mgu-store: off leaves it');
let threw = false; try { run('x'); } catch (e) { threw = e.status === 2; }
ok(threw, 'anything else: exit 2');
cp.execFileSync("rm", ["-rf", dir]);
console.log(fails ? fails + ' failed' : 'all ok');
process.exit(fails ? 1 : 0);
