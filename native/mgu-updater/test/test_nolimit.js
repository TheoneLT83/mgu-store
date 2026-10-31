'use strict';
/**
 * A GitHub source without a token past the API's 60 requests an hour (a car on a shared mobile address):
 * an artifact named by its asset's API URL comes from the release's download link, a changelog from
 * raw.githubusercontent.com, an icon from the asset's download link. With a token nothing changes.
 *
 *   node test/test_nolimit.js
 */
const assert = require('assert');
const { reader } = require('../js/sources');

let checks = 0;
const ok = (c, m) => { checks += 1; assert(c, m); };
const LIMITED = Object.assign(new Error('HTTP 403 from api.github.com'), { status: 403, rateLimited: true });

function source(token) {
    const seen = [];
    const net = {
        get: (url, headers) => {
            seen.push({ url, auth: headers.Authorization || null });
            return /api\.github\.com\/repos\/o\/r\/(releases\/assets|contents)\//.test(url) ? Promise.reject(LIMITED)
                : Promise.resolve(Buffer.from('ok ' + url));
        },
        cached: (url) => {
            seen.push({ url });
            return Promise.resolve(Buffer.from(JSON.stringify({ tag_name: 'catalog', assets: [
                { name: 'catalog.json', url: 'https://api.github.com/repos/o/r/releases/assets/1', size: 9,
                    browser_download_url: 'https://github.com/o/r/releases/download/catalog/catalog.json' },
                { name: 'icon.png', url: 'https://api.github.com/repos/o/r/releases/assets/2', size: 9,
                    browser_download_url: 'https://github.com/o/r/releases/download/catalog/icon.png' }] })));
        }
    };
    const ctx = { net, version: '0.8.10', githubApi: 'https://api.github.com', githubRaw: 'https://raw.githubusercontent.com',
        githubWeb: 'https://github.com', tokenFor: () => token, reuse: () => null };
    return { r: reader({ id: 'src', type: 'github', repo: 'o/r' }, ctx), seen };
}

const entry = { id: 'tool', version: '1.2.3', artifact: { name: 'tool@1.2.3.tgz', size: 9,
    url: 'https://api.github.com/repos/o/r/releases/assets/7' } };

(function () {
    const a = source(null);
    return a.r.artifact(entry).then((b) => {
        ok(String(b) === 'ok https://github.com/o/r/releases/download/tool%401.2.3/tool%401.2.3.tgz', 'no token, limit spent: the download link');
        return a.r.text('native/tool/CHANGELOG.md', null);
    }).then((t) => {
        ok(t === 'ok https://raw.githubusercontent.com/o/r/HEAD/native/tool/CHANGELOG.md', 'no token: the changelog from raw');
        ok(!a.seen.some((x) => /\/contents\//.test(x.url)), 'no token: no contents API');
        const b = source('tok');
        return b.r.artifact(entry).then(() => assert.fail('a token keeps the API URL'), (err) => {
            ok(err === LIMITED && b.seen.length === 1 && b.seen[0].auth === 'Bearer tok', 'with a token: the API URL, no fallback');
        });
    });
})().then(() => console.log(`nolimit: ${checks} checks pass`), (e) => { console.error(e); process.exit(1); });
