'use strict';
/**
 * switch.js on|off - the Store's own source (the updater's built-in one) for this car.
 *
 *   on   the Store's own source reads TheoneLT83/mgu-store: builtin_repo in the updater's own settings
 *        (updater.local.conf) and the repo of that source in its saved list (sources.json), which the updater
 *        takes over the setting. What it installed (the Store, the updater, the deploy tool and the Store's
 *        tools) takes its updates from there, as its versions there are newer, once the updater starts again
 *   off  that line taken out, and the saved source back on the repo it read before (store-switch.json)
 *
 * Run by the deploy tool as root, the tool's activate (on) and deactivate (off), on the head unit's Node 8. The rest of the file is kept;
 * root's alone (it can hold a proxy's password) and on disk before it returns, as the updater writes it. The
 * last stdout line asks for the head unit's start that the updater needs to read it.
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.MGU_UPDATER_CONF || '/var/opt/mgu-updater/updater.local.conf';
const KEY = 'builtin_repo', REPO = 'TheoneLT83/mgu-store';
const DIR = path.dirname(FILE);
const WAS = path.join(DIR, 'store-switch.json');

function read(file) {
    try { return fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return []; }
}

/* The folder and its parents (Node 8, the head unit's: no recursive mkdir). */
function mkdirs(dir) {
    if (fs.existsSync(dir)) return;
    mkdirs(path.dirname(dir));
    fs.mkdirSync(dir, 0o755);
}

/* text into file by rename, root's alone and on disk, as the updater writes its files. */
function write(file, text) {
    mkdirs(path.dirname(file));
    const tmp = file + '.tmp';
    try { fs.unlinkSync(tmp); } catch (e) { /* none */ }
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
}

/* key = value in file (removed when value is empty), the rest kept. Returns whether it changed. */
function set(file, key, value) {
    const was = read(file);
    const lines = was.filter((l) => !new RegExp('^\\s*' + key + '\\s*=').test(l));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (value) lines.push(key + ' = ' + value);
    const text = lines.length ? lines.join('\n') + '\n' : '';
    if (text === (was.length ? was.join('\n') : '')) return false;
    write(file, text);
    return true;
}

/* The updater's saved sources: the file its own settings name, else its default. */
function sourcesFile() {
    let file = path.join(DIR, 'sources.json');
    read(FILE).some((l) => {
        const m = /^\s*sources\s*=\s*(\S+)/.exec(l);
        return m && (file = m[1]);
    });
    return process.env.MGU_UPDATER_SOURCES || file;
}

/* The repo of the saved built-in source set to repo (none: the one recorded in WAS). Returns whether it changed. */
function setSaved(on) {
    const file = sourcesFile();
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return false; } // none saved: the setting is read
    const own = doc && Array.isArray(doc.sources) && doc.sources.filter((s) => s && s.builtin && s.type === 'github')[0];
    if (!own) return false;
    let repo;
    if (on) {
        if (own.repo === REPO) return false;
        write(WAS, JSON.stringify({ repo: own.repo }) + '\n');
        repo = REPO;
    } else {
        try { repo = JSON.parse(fs.readFileSync(WAS, 'utf8')).repo; } catch (e) { /* none recorded */ }
        try { fs.unlinkSync(WAS); } catch (e) { /* none */ }
        if (!repo || own.repo !== REPO) return false;
    }
    own.repo = repo;
    write(file, JSON.stringify(doc, null, 2) + '\n');
    return true;
}

function main(arg) {
    if (arg !== 'on' && arg !== 'off') {
        console.error('usage: switch.js on|off');
        return 2;
    }
    const saved = setSaved(arg === 'on');
    const changed = set(FILE, KEY, arg === 'on' ? REPO : '') || saved;
    console.log(arg === 'on' ? 'the Store\'s own source: ' + REPO : 'the Store\'s own source: the updater\'s own again');
    // the updater reads its settings at its start
    console.log(JSON.stringify(changed ? { reboot: 'the updater reads its new source at the next start' }
        : { status: arg === 'on' ? 'the Store\'s own source is ' + REPO : 'the Store\'s own source is the updater\'s own' }));
    return 0;
}

module.exports = { set, read, setSaved, FILE, KEY, REPO };
if (require.main === module) process.exitCode = main(process.argv[2]);
