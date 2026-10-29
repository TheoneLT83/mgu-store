# CarPlay multitouch (Store tool)

Two fingers on the touchscreen in CarPlay (pinch to zoom in maps), from
[MareXcodemaster/idrive7-carplay-multitouch](https://github.com/MareXcodemaster/idrive7-carplay-multitouch)
(MIT, see `LICENSE`), installed and removed from the MGU Store (it comes with the Store at its first install).

`agent.js`, `read-voltage.js`, `patch/` and `runtime/` are that project's files at commit
`a63052d` (release 0.1.0), unchanged. `multitouch.js` runs them for mgu-deploy:

- **Install** (`postInstall`): checks the car's `/usr/bin/carplay`. Only the one build the patch was
  made for is patched (iDrive 7 `P18_23w44.2-1-3`, size 3,484,912 bytes, SHA-256
  `ddb33e33161387c6479c391684b3d019b0de54ecfcee8d6877eca94aa62f3e50`); on any other car nothing
  changes and the Store says so. The patched copy goes to `/var/opt/mgu-carplay-multitouch` beside
  the factory program, which is never changed, with a drop-in for `carplay.service`. It takes
  effect at the next start of the head unit; a startup guard falls back to the factory program if
  the patched one does not come up healthy. The supply must be at least 13.0 V: with the engine
  off the tool tries again every 30 s for 2 h in the background (`/var/opt/carplay-multitouch/retry.log`).
- **Uninstall** (`preUninstall`, mgu-deploy 0.6.4 or newer): the drop-in and the patched copy are
  removed; the factory CarPlay runs from the next start. If that fails, the tool stays installed.
- A patch put on with the project's own installer is taken over as it is.

Confirmed with a wireless CarPlay Android AI box; a direct iPhone connection is not tested yet.
Three or more fingers are not supported.

Test: `node native/carplay-multitouch/test/test.js`; the project's own tests are in its repository.
