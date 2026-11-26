'use strict';
/* sources.js lastTarball: a repo's tarball at a commit downloaded once for the builds that follow from it. */
const assert = require('assert');
const { lastTarball } = require('../js/sources.js');

(async () => {
    let n = 0;
    const dl = (v) => () => { n++; return Promise.resolve(Buffer.from(v)); };
    assert.strictEqual(String(await lastTarball('o/r@a', dl('A'))), 'A');
    assert.strictEqual(String(await lastTarball('o/r@a', dl('X'))), 'A');
    assert.strictEqual(n, 1, 'the same commit again: no second download');
    assert.strictEqual(String(await lastTarball('o/r@b', dl('B'))), 'B');
    assert.strictEqual(n, 2, 'another commit: downloaded');
    let failed = false;
    await lastTarball('o/r@c', () => { n++; return Promise.reject(new Error('net')); }).catch(() => { failed = true; });
    assert.ok(failed);
    assert.strictEqual(String(await lastTarball('o/r@c', dl('C'))), 'C');
    assert.strictEqual(n, 4, 'a failed download is not kept');
    console.log('tarball: all ok');
})().catch((e) => { console.error(e); process.exit(1); });
