'use strict';
/**
 * switch.js on|off - the Store's own source (the updater's built-in one) for this car.
 *
 *   on   builtin_repo = TheoneLT83/mgu-store in the updater's own settings (updater.local.conf): what the
 *        built-in source installed (the Store, the updater, the deploy tool and the Store's tools) takes its
 *        updates from TheoneLT83/mgu-store, as its versions there are newer, once the updater starts again
 *   off  that line taken out: the updater's own built-in source again
 *
 * Run by the deploy tool as root, the tool's activate (on) and deactivate (off). The rest of the file is kept;
 * root's alone (it can hold a proxy's password) and on disk before it returns, as the updater writes it. The
 * last stdout line asks for the head unit's start that the updater needs to read it.
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.MGU_UPDATER_CONF || '/var/opt/mgu-updater/updater.local.conf';
const KEY = 'builtin_repo', REPO = 'TheoneLT83/mgu-store';

function read(file) {
    try { return fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return []; }
}

/* key = value in file (removed when value is empty), the rest kept. Returns whether it changed. */
function set(file, key, value) {
    const was = read(file);
    const lines = was.filter((l) => !new RegExp('^\\s*' + key + '\\s*=').test(l));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (value) lines.push(key + ' = ' + value);
    const text = lines.length ? lines.join('\n') + '\n' : '';
    if (text === (was.length ? was.join('\n') : '')) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
    const tmp = file + '.tmp';
    try { fs.unlinkSync(tmp); } catch (e) { /* none */ }
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    return true;
}

function main(arg) {
    if (arg !== 'on' && arg !== 'off') {
        console.error('usage: switch.js on|off');
        return 2;
    }
    const changed = set(FILE, KEY, arg === 'on' ? REPO : '');
    console.log(arg === 'on' ? 'the Store\'s own source: ' + REPO : 'the Store\'s own source: the updater\'s own again');
    // the updater reads its settings at its start
    console.log(JSON.stringify(changed ? { reboot: 'the updater reads its new source at the next start' }
        : { status: arg === 'on' ? 'the Store\'s own source is ' + REPO : 'the Store\'s own source is the updater\'s own' }));
    return 0;
}

module.exports = { set, read, FILE, KEY, REPO };
if (require.main === module) process.exitCode = main(process.argv[2]);
