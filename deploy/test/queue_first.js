'use strict';
/* Runs installs through the copy built from fixtures/main_queue.js (argv[2]):
 * six of BMW's apps that fail with a network error (60 ms a try, retry
 * delay from 40 ms, doubling), then the apps argv[3] names (default: ours,
 * a second of ours and one app not listed), each 3 ms; one named in argv[4]
 * fails with a network error too. With argv[5] "empty", the named apps
 * go first into an empty queue the others left a retry wait behind (the
 * controller's retry count at 4), BMW's apps right after them. Prints the
 * order the apps ran in and the log. */
const built = require(process.argv[2]);
const bmw = ['bmw_1', 'bmw_2', 'bmw_3', 'bmw_4', 'bmw_5', 'bmw_6'];
const ran = [], done = {}, t0 = Date.now();
const later = process.argv[3] ? process.argv[3].split(',') : ['our_app', 'their_app', 'other_app'];
const failing = process.argv[4] || '';
const empty = process.argv[5] === 'empty';
const ctl = new built.AppManagementController((app) => new Promise((res, rej) => {
    ran.push(app);
    const fails = bmw.indexOf(app) >= 0 || app === failing;
    setTimeout(() => (fails ? rej(new Error('NETWORK_ERROR')) : res()), bmw.indexOf(app) >= 0 ? 60 : 3);
}), 40);
const ours = () => later.forEach((a) => ctl.install(a).then(() => { done[a] = Date.now() - t0; }));
if (empty) {
    ctl.retries = 4;
    ours();
    bmw.forEach((a) => ctl.install(a).catch(() => {}));
} else {
    bmw.forEach((a) => ctl.install(a).catch(() => {}));
    setTimeout(ours, 100);
}
setTimeout(() => {
    console.log(JSON.stringify({ ran: ran.slice(0, 40), done, log: (global.__fixtureLog || []).filter((l) => /^mgu-deploy/.test(l)) }));
    process.exit(0);
}, 1500);
