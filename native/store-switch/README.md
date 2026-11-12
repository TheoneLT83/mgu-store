# Switch to TheoneLT83's Store (`store-switch`)

A car that got the Store from robertnisipeanu/mgu-store can't install this repository's Store from the Store
itself: the updater lets only the source an app came from update it ("robertn_store is already installed"),
and the Store's own source can't be removed.

This tool, installed from the Store like any other, writes one line into the updater's own settings
(`/var/opt/mgu-updater/updater.local.conf`, which the updater reads over its `updater.conf` at its start):

    builtin_repo = TheoneLT83/mgu-store

and, as the updater takes its saved sources (`sources.json`) over that setting, sets the Store's own source
there to the same repo, recording the one it read before in `store-switch.json`.

After the next start of the head unit, the Store's own source is this repository: the Store, the updater, the
deploy tool and the Store's tools take their updates from here, as updates (their versions here are newer).
Removing the tool takes the line out and puts the saved source back on the recorded repo; what was updated stays.

- `activate`: `node switch.js on`; `deactivate`: `node switch.js off` (root, by the deploy tool). The rest of
  each file is kept, each root's alone (0600), on disk before it returns. A change asks for a head-unit
  start (the updater reads the file at its start); the same setting again asks for none.
- Test: `node test/switch_test.js`.
