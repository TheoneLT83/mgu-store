'use strict';
/* foreground_gate.js readApps: which uid an app's RHMI uuid is, from the installed apps' folders. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readApps } = require('../js/foreground_gate.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-apps-'));
const app = (uid, uuid) => {
    fs.mkdirSync(path.join(root, `oap_${uid}`, 'rhmiData'), { recursive: true });
    fs.writeFileSync(path.join(root, `oap_${uid}`, 'rhmiData', 'application.json'), JSON.stringify({ application: { uuid } }));
};
const registered = (appId, uid) => {
    fs.mkdirSync(path.join(root, 'oap_12201', 'data', 'apps'), { recursive: true });
    fs.writeFileSync(path.join(root, 'oap_12201', 'data', 'apps', `${appId}.json`), JSON.stringify({ userId: uid }));
};
const logs = [];
app(12301, 'u-one');
app(12302, 'u-two');
app(12303, 'u-two');            // an earlier install of the same app, its folder left behind
app(12304, 'u-three');
app(12305, 'u-three');          // two folders, neither registered
registered('two', 12303);
const apps = readApps(root, (l) => logs.push(l));
assert.strictEqual(apps.get('u-one'), 12301, 'one folder: its uid');
assert.strictEqual(apps.get('u-two'), 12303, 'two folders: the one the app manager has registered');
assert.strictEqual(apps.has('u-three'), false, 'two folders, none registered: left out');
assert.ok(logs.some((l) => /u-three/.test(l)) && !logs.some((l) => /u-two/.test(l)), logs.join('\n'));
fs.rmSync ? fs.rmSync(root, { recursive: true, force: true }) : null;
console.log('test_gate_apps: 3 checks pass');

/* findInterface: a description in a package's src-gen folder under /usr/lib, when none of the known files is there */
const { findInterface } = require('../js/foreground_gate.js');
const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lib-'));
fs.mkdirSync(path.join(lib, 'oap-mainapp-655', 'src-gen', 'someip'), { recursive: true });
const desc = path.join(lib, 'oap-mainapp-655', 'src-gen', 'someip', 'de_bmw_infotainment_hmi_remote_RemoteHmiApplication.json');
fs.writeFileSync(desc, JSON.stringify({ instances: { a: {} } }));
const found = findInterface([path.join(lib, 'missing.json')], path.join(lib, 'no-apps'), lib);
assert.strictEqual(found && found.file, desc, 'src-gen description found');
assert.strictEqual(findInterface([], path.join(lib, 'no-apps'), path.join(lib, 'none')), null, 'none: null');
fs.rmSync ? fs.rmSync(lib, { recursive: true, force: true }) : null;
