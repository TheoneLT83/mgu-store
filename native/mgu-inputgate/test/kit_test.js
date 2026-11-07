'use strict';
/* The controller gate's install kit (kit/, component.json) is the one the updater makes for a repository's preload
 * tool of this id (native/mgu-updater/js/sources.js preloadFiles, packPreload: idrive7-apps' mgu-inputgate), file for
 * file, so whichever source installed it, the gate on the head unit is the same and either updates it. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const { preloadFiles } = require(path.join(HERE, '..', 'mgu-updater', 'js', 'sources.js'));
const entry = JSON.parse(fs.readFileSync(path.join(HERE, 'kit', 'entry.json'), 'utf8'));
const c = JSON.parse(fs.readFileSync(path.join(HERE, 'component.json'), 'utf8'));
const f = preloadFiles(entry);
const read = (from) => fs.readFileSync(path.join(HERE, from), 'utf8');
let checks = 0;
const eq = (a, b, msg) => { checks++; assert.deepStrictEqual(a, b, msg); };

eq([c.id, c.title], [entry.id, entry.title], 'component.json: the id and title of the repositories\' gate');
eq(read('kit/guard.sh'), f.guardSh, 'guard.sh as the updater writes it');
eq(c.files.map((x) => [x.path, x.mode]), [[entry.preload.library, '0755'], ['guard.sh', '0755']], 'the library and guard.sh, 0755');
eq(c.files[1].from, 'kit/guard.sh');
eq(c.units.map((u) => u.name), [f.guard, f.check], 'the guard and check units');
c.units.forEach((u, i) => eq(read(u.from), [f.guardUnit, f.checkUnit][i], `${u.name} as the updater writes it`));
eq(c.dropins.map((d) => [d.unit, d.name]), [[entry.preload.unit, f.dropinName]], 'the drop-in in hmi.service');
eq(read(c.dropins[0].from), f.dropin, `${f.dropinName} as the updater writes it`);
eq([c.enable, c.recmgr, c.restart], [[], [], []], 'nothing enabled, listed or restarted: the HMI loads it at its next start');

/* guard.sh stop, run: the count goes back to 0 only while the process that first loaded the library still runs
 * it with the unit active (a normal shutdown ending a start), not when it is gone, another, or without it. */
{
    const os = require('os');
    const cp = require('child_process');
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'inputgate-'));
    const bin = path.join(T, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'pidof'), '#!/bin/sh\necho 4242\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\n[ -f "$GATE_ACTIVE" ]\n', { mode: 0o755 });
    const sh = f.guardSh.split('D=/var/opt/mgu-inputgate').join(`D=${T}/opt`)
        .split('RUN=/run/mgu-inputgate.env').join(`RUN=${T}/run.env`).split('PID=/run/mgu-inputgate.pid').join(`PID=${T}/run.pid`)
        .split('/proc/$p/').join(`${T}/proc/$p/`);
    fs.mkdirSync(path.join(T, 'opt', 'versions', '1.0.1'), { recursive: true });
    fs.symlinkSync('versions/1.0.1', path.join(T, 'opt', 'current'));
    fs.writeFileSync(path.join(T, 'opt', 'strikes.version'), 'versions/1.0.1\n');
    fs.writeFileSync(path.join(T, 'guard.sh'), sh);
    const stop = ({ pidFile, maps, active }) => {
        fs.writeFileSync(path.join(T, 'opt', 'strikes'), '1\n');
        fs.rmSync(path.join(T, 'run.pid'), { force: true });
        fs.rmSync(path.join(T, 'proc'), { recursive: true, force: true });
        if (pidFile) fs.writeFileSync(path.join(T, 'run.pid'), pidFile + '\n');
        if (maps) { fs.mkdirSync(path.join(T, 'proc', '4242'), { recursive: true }); fs.writeFileSync(path.join(T, 'proc', '4242', 'maps'), maps); }
        const flag = path.join(T, 'active');
        if (active) fs.writeFileSync(flag, ''); else fs.rmSync(flag, { force: true });
        const r = cp.spawnSync('sh', [path.join(T, 'guard.sh'), 'stop'], { encoding: 'utf8',
            env: Object.assign({}, process.env, { PATH: `${bin}:${process.env.PATH}`, GATE_ACTIVE: flag }) });
        return fs.readFileSync(path.join(T, 'opt', 'strikes'), 'utf8').trim() + (r.status ? ` exit ${r.status}` : '');
    };
    const LIB = '7f0000-7f1000 r-xp 00000000 08:01 1 /var/opt/mgu-inputgate/current/mgu-inputgate.so\n';
    eq(stop({ pidFile: '4242', maps: LIB, active: true }), '0', 'stop: the process that loaded it still runs it: the start counts as healthy');
    eq(stop({ pidFile: null, maps: LIB, active: true }), '1', 'stop: no process seen with it at this start: the strike stays');
    eq(stop({ pidFile: '4242', maps: '7f0000-7f1000 r-xp 00000000 08:01 1 /usr/lib/other.so\n', active: true }), '1',
        'stop: the process runs without it: the strike stays');
    eq(stop({ pidFile: '4242', maps: null, active: true }), '1', 'stop: the process that loaded it is gone (crashed): the strike stays');
    eq(stop({ pidFile: '4242', maps: LIB, active: false }), '1', 'stop: the unit is not active: the strike stays');
    fs.rmSync(T, { recursive: true, force: true });
}
console.log(`mgu-inputgate kit: ${checks} checks pass`);
