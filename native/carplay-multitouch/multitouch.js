'use strict';
/* The Store's CarPlay multitouch tool: MareXcodemaster/idrive7-carplay-multitouch's
 * agent.js (unchanged beside this file) run by mgu-deploy.
 *
 *   node multitouch.js install    postInstall: the patch for the next start, or nothing on a car
 *                                 whose CarPlay build is not the one it was made for; with too
 *                                 little voltage it tries again in the background (RETRY_MS)
 *   node multitouch.js uninstall  preUninstall: the patch out again (factory CarPlay from the next
 *                                 start); a failure keeps the tool, so the patch is never orphaned
 *   node multitouch.js status     the agent's status
 *
 * The patch lives in the agent's own folder (/var/opt/mgu-carplay-multitouch), apart from the
 * tool's (/var/opt/carplay-multitouch): one installed with the project's own installer before is
 * taken over as it is. Node 8. */
var fs = require('fs'), path = require('path'), cp = require('child_process');

var PATCH_ROOT = '/var/opt/mgu-carplay-multitouch';
var PACKAGE = 'idrive7-carplay-multitouch';
var TOOL_ROOT = '/var/opt/carplay-multitouch';
var RETRY_MS = 30000, RETRY_FOR_MS = 2 * 3600 * 1000;

function createTool(deps) {
    deps = deps || {};
    var f = deps.fs || fs, agent = deps.agent || null, out = deps.log || function (l) { console.log(l); };
    var spawn = deps.spawn || cp.spawn, proc = deps.process || process;
    var patchRoot = deps.patchRoot || PATCH_ROOT, toolRoot = deps.toolRoot || TOOL_ROOT;
    var agentOf = function () { return agent || (agent = require('./agent.js')); };
    var version = function () { return require('./patch/patch.json').release; };
    var readJson = function (p) { try { return JSON.parse(f.readFileSync(p, 'utf8')); } catch (e) { return null; } };
    var installed = function () { var m = readJson(path.posix.join(patchRoot, 'install.json')); return m && m.package === PACKAGE ? m : null; };
    var retryFile = path.posix.join(toolRoot, 'retry.pid');
    var lowVoltage = function (e) { return /13\.0 V|Voltage getter|LevelMonitor/.test(String(e && e.message || e)); };

    /* a retry loop started at an earlier install: stopped */
    function stopRetry() {
        var pid = 0;
        try { pid = Number(f.readFileSync(retryFile, 'utf8').trim()); } catch (e) { return; }
        try { f.unlinkSync(retryFile); } catch (e) { /* gone */ }
        if (pid > 1 && pid !== proc.pid) { try { proc.kill(pid, 'SIGTERM'); } catch (e) { /* not running */ } }
    }
    function startRetry() {
        stopRetry();
        var log = f.openSync(path.posix.join(toolRoot, 'retry.log'), 'a');
        var child = spawn(proc.execPath, [path.join(__dirname, 'multitouch.js'), 'retry'], { detached: true, stdio: ['ignore', log, log], cwd: __dirname });
        f.closeSync(log);
        f.writeFileSync(retryFile, String(child.pid) + '\n');
        child.unref();
    }

    /* the patch for the next start: { state, message } */
    function install() {
        var a = agentOf(), prior = installed();
        if (prior && prior.version !== version()) {
            out('Replacing the patch ' + prior.version + ' with ' + version());
            a.uninstall();
        }
        try {
            a.preflight();
        } catch (e) {
            if (/Unsupported factory CarPlay executable/.test(e.message)) {
                return { state: 'unsupported', message: 'This car\'s CarPlay build is not the one the patch was made for (iDrive 7 ' +
                    'P18_23w44.2-1-3, CarPlay SHA-256 ddb33e33...3e50): nothing changed, CarPlay stays as it is.' };
            }
            return { state: 'refused', message: 'Not installed: ' + e.message + '. Nothing changed.' };
        }
        var r = a.install();
        return { state: r.state, message: r.state === 'already-installed'
            ? 'The patch is installed. Two-finger touch in CarPlay: ' + (r.status && r.status.activePatched ? 'on.' : 'from the next start of the head unit.')
            : 'Installed for the next start of the head unit: then two fingers work in CarPlay (pinch to zoom). The factory CarPlay program is unchanged.' };
    }

    function run(action) {
        if (action === 'install') {
            var r;
            try { r = install(); } catch (e) {
                if (!lowVoltage(e)) throw e;
                startRetry();
                r = { state: 'waiting', message: 'The supply is below 13.0 V (engine off): the patch installs by itself once the engine runs ' +
                    '(tried every 30 s for 2 h), or install the tool again with the engine running.' };
            }
            if (r.state !== 'waiting') stopRetry();
            out(r.message);
            return r;
        }
        if (action === 'uninstall') {
            stopRetry();
            if (!installed()) { out('No patch installed: nothing to take out.'); return { state: 'none' }; }
            var u = agentOf().uninstall();
            out('The patch is taken out: factory CarPlay from the next start of the head unit.');
            return u;
        }
        if (action === 'status') {
            var s = agentOf().status();
            out(JSON.stringify(s, null, 2));
            return s;
        }
        throw new Error('usage: node multitouch.js install|uninstall|status');
    }

    /* the background retry: install() every RETRY_MS while the voltage is too low */
    function retry(done) {
        var until = Date.now() + RETRY_FOR_MS, timer = deps.setTimeout || setTimeout;
        var again = function () {
            var r = null, err = null;
            try { r = install(); } catch (e) { err = e; }
            if (err && lowVoltage(err) && Date.now() < until) { timer(again, RETRY_MS); return; }
            try { f.unlinkSync(retryFile); } catch (e) { /* gone */ }
            out(new Date().toISOString() + ' ' + (err ? 'gave up: ' + err.message : r.message));
            if (done) done(err, r);
        };
        timer(again, RETRY_MS);
    }
    return { run: run, retry: retry, install: install };
}

module.exports = { createTool: createTool, PACKAGE: PACKAGE };
if (require.main === module) {
    var tool = createTool(), action = process.argv[2];
    try {
        if (action === 'retry') tool.retry(function (e) { process.exitCode = e ? 1 : 0; });
        else tool.run(action);
    } catch (e) {
        console.error(String(e.message || e));
        process.exitCode = 1;
    }
}
