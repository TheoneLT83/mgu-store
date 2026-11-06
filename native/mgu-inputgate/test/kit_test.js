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
console.log(`mgu-inputgate kit: ${checks} checks pass`);
