# mgu-render changelog

## 0.6.23

- robertnisipeanu/mgu-store's 0.6.19 with this repository's renderer: no Remove in the Store, the renderer stays while the
  Store is installed.

## 0.6.22

- robertnisipeanu/mgu-store's 0.6.18 with this repository's renderer:
  - The page template stops being mounted into the HMI after two boots that mounted it and ended in an HMI failure, with no healthy boot between them: a restart record of recmgr (`hmi.service`) or crashhandler (`HmiMain3D`) written after the mount, read at the shutdown (a drop-in of `var-opt-ro.service`) or at the next boot. A boot counts only on such a record; a switch-off, a restart from BMW's menu, the Store or an update, `systemctl reboot`, a power cut or a slow HMI counts nothing, and an HMI that ran 120 s unbroken with the template clears the count. The HMI then starts with its stock widgets, apps get their layer, and the Renderer's page says `In-page drawing unavailable: the HMI failed with the page template` until another HmiMain3D or template comes. README.md, "The HMI and the page template".

## 0.6.21

- robertnisipeanu/mgu-store's 0.6.16 and 0.6.17 with this repository's renderer (its own touch table and ports kept, `touch_table`, `touch_port`):
  - The touch divert rule's nft commands run beside the render loop, never in it: the renderer keeps drawing, answering apps and beating to its guard while nft works. An nft run that takes longer than 10 s is stopped and counts as failed. A failed load is logged once and tried again every 5 s (`touch: loading the nft rule failed, touch stays the HMI's; trying again every 5 s`). At exit the guard takes the rule out. A slow nft (over 1.5 s per run) blocked the loop while touch was diverted, so the guard killed the renderer each time an app gave up its touch area; repeated kills hit the service's start limit, and the deploy check after an update failed with `render.sock: EPIPE`.
  - The car-test guide rehearses on any test head unit reached over SSH.
  - An idrive7-apps kit app on our socket goes back to the community socket `/run/mgu-renderd/renderd.sock` once another renderer (idrive7-renderd) has listened there for 5 s: its connection is closed, and the kit connects again, to that socket unless an earlier failed try there turned it to ours (`<app>: kit app sent back to /run/mgu-renderd/renderd.sock, which has its own renderer again`). Kit apps came to us whenever idrive7-renderd restarted (each of its updates, a crash) and stayed until mgu-render restarted, drawn for the wrong screen on cars whose display differs. An app that comes back within 60 s is sent again only after 30 s, then 2 min; after a third time it stays. Without another renderer there, and for every app that is not a kit app (the Store included), nothing changes.

## 0.6.20

- robertnisipeanu/mgu-store's touch-divert fix with this repository's renderer: the rule is removed with `nft delete table` straight (no file), so it comes out even when /tmp is full, and an absent table is not an error. The rule still goes to nft in a file and counts only when its table is there afterwards.

## 0.6.19

- 0.6.18 built again: a change to its car-test tool, since taken back, gave 0.6.18's tree a newer date, and a release publishes no other content under a published version.

- Build: the build image's tag is a hash of its definition, so builds from different definitions never share an image.
No changes.

## 0.6.19

- No Remove in the Store: the Renderer stays while the Store is installed.

## 0.6.18

- robertnisipeanu/mgu-store's 0.6.12 with this repository's renderer: the foreground gate maps an RHMI uuid that more than one `oap_<uid>` folder claims (an earlier install's folder left behind) to the install the app manager has registered (`oap_12201/data/apps/<id>.json`), when exactly one of them is registered; otherwise the uuid stays unmapped, so an app still cannot take another app's uuid. A left-behind folder of the Store kept it out of front for good, and its page stayed black under the HMI's title.

## 0.6.17

- 0.6.16's source built again: the binary built for 0.6.16 was published from an earlier build, and a release publishes no other content under a published version.

## 0.6.16

- robertnisipeanu/mgu-store's 0.6.11 with this repository's renderer:
  - iDrive 7: `touch_area = auto` is 84,0,1836,720, the title strip included. With 84,76,1836,644 a tap on an app's own header tab (the idrive7-apps kit draws its tabs there) went to the HMI, which closed the app: black screen. Apps never claim the status icons, so they still reach the HMI.
  - `local_conf` (default `/var/opt/mgu-render/mgu-render.local.conf`): a unit's own settings, read after the shipped file and every `-s`. An update replaces `mgu-render.conf`; the local file stays, so a setting changed on the car is no longer lost at the next update. Absent: nothing; a bad line is logged and skipped, the good ones apply.

## 0.6.15

- robertnisipeanu/mgu-store's 0.6.10 with this repository's renderer: each yield surface's visibility and buffer is logged as it changes, and overlays (`overlay_apps`, empty by default, iDrive 8 only): a root client with a listed app id stays shown over the yield surfaces, gets touch first and its layer is put back on top; while one claims, the touch rule goes in again every 10 s. A yield surface still needs a size on iDrive 7 too (this repository's 0.6.10), and the touch table and ports stay configurable (`touch_table`, `touch_port`).

## 0.6.14

- robertnisipeanu/mgu-store's 0.6.9 with this repository's renderer: its foreground gate replaces 0.6.12's. The description is looked for in the known files, then in the `src-gen` folders of the packages under `/usr/lib` (0.6.12's search), then in the apps' `someipInterfaces` copies; a uuid two folders claim still goes to the registered one (0.6.11). With no description the renderer offers gated apps no mode (they keep their own screens) instead of showing them without a gate. Its notes:
  - The foreground gate finds the HMI's `RemoteHmiApplication` description on iDrive 7 firmware that keeps it elsewhere: after `/usr/lib/oap-mainapp/src-gen/` and the iDrive 8 one, `/usr/lib/oap-mainapp/src-gen/someip/`, then the copy MainApp's installer writes for each app whose manifest names the interface (`/var/opt/public/oap/oap_<uid>/someipInterfaces/`, the one with the most instances).
  - With no description anywhere, the gate says so (`unavailable`) and is not started again. mgu-render/1 apps it gates are offered no mode, so they keep their own screens (the Store its widget screens); those connected before are disconnected once and get that on their next connection.

## 0.6.13

- Touch: the divert rule goes to nft in a file (`/tmp/mgu-render-nft-*`), and a load counts only when the table is then there. The nft of MainApp 6.5.5 cars cannot read a script from `-`: the rule never went in while the log said `touch: diverted`, and touches never reached the Store or the apps.

## 0.6.12

- Foreground gate on an app manager without `src-gen/de_bmw_infotainment_hmi_remote_RemoteHmiApplication.json` (MainApp 6.5.5's single bundle): the description is looked for in the `src-gen` folders of the packages under `/usr/lib`; without one the gate says `foreground unavailable` once and stays, and the renderer shows the apps as without a gate. Before, the gate exited at start every 5 s and no native app (the Store, the idrive7-apps kit's apps) was ever shown.

## 0.6.11

- Foreground gate: an app whose RHMI uuid another folder claims too (an earlier install's `oap_<uid>` left behind) is the one the app manager has registered (`oap_12201/data/apps/<appId>.json`), when exactly one of them is. Before, such an app was never in front, and the idrive7-apps kit drew it in the HMI's own picture instead of the renderer. `test/test_gate_apps.js`.

## 0.6.10

- An HMI surface makes the layer apps yield the screen only while it is visible and has a size (its configuration). The camera / driver-assistance video (dasvideo, surface 0x198) can stay visible at 0x0 on no layer from boot, showing nothing: every app and the Store were then hidden until the next reboot (seen on the car: "surface 0x198 visible: layer apps yield the screen" at start, never hidden again).

## 0.6.9

- robertnisipeanu/mgu-store's 0.6.7 and 0.6.8 (below) with this repository's renderer: its layer handling replaces 0.6.6's, and the install step stays `mgu-render-install.sh`.

## 0.6.8

- `render_check.js`, the deploy tool's check after an update (`check` in `component.json`; needs mgu-deploy 0.6.10): a client connects to the renderer's socket and must get its native answer (X_READY, then READY with a screen size); 20 s later the service must still run with no restart, and a second connection must get READY again. It draws nothing. A renderer that fails it goes back to the version before, at the install or at the next start of the head unit.

## 0.6.7

- A layer app's layer goes onto the centre screen through a connection made for it and closed again (`src/relist.c`), never through the renderer's own long-lived one. Winston applies a screen's `add_layer` to the layer list as the calling connection last saw or set it, so a connection open a while dropped every layer other programs (the HMI, another renderer) put on the screen since. The new connection sees the list as it is: our layer goes on top and every other layer stays.
- When another program sets the screen's layers without ours, Winston says so (the layer's `screen` event) and the layer goes back on top: at once while the app is shown, at its next show otherwise. Taken off more than 10 times in 10 s while shown, it goes back at its next show (journal: `layer taken off the screen`).

## 0.6.6

- An app's layer that something else takes off the centre screen while the app shows (the HMI or another renderer setting the screen's layers, as an app install's restart of the app manager can) goes back on, on top, and the journal says so (`layer taken off the screen while shown - put back`). The app went on drawing and reported on screen while the HMI's page showed under it: the Store's empty list during an app install.

## 0.6.5

- `fps` and `fps.<app>` (0): the frames a second an app that asks for a rate (FPS) gets, in place of the rate it asks; for every such app, or for one (`fps.robertn_store = 30`). Display-bridge apps ask for none and are not paced by it.
- While `/run/mgu-render/stats-log` exists, each step of an app's frames and touches goes to `/run/mgu-render/trace.log` (`<us> R <step> <n> <app>`, CLOCK_MONOTONIC): touch in and forwarded, TICK sent, frame received, draw start and end, commit, the HMI's frame callback; `tools/car-test/trace.js` lines it up with the Store's.

## 0.6.4

- An app's layer goes back on the centre screen, on top, each time it is shown: another renderer (the MGU Store's beside idrive7-apps') or the HMI could set the screen's layers without it, and the app then showed a black page (seen on the car after opening the Store, then an app).

## 0.6.3

- The old GPU renderers are set aside at install again (`mgu-render-retire.sh`): idrive7-apps' installer's `mgu-renderd.service` and idrive7-renderd 1.x, which 0.6.2 put back and which do not speak mgu-render/1 (the apps then showed their old screen). idrive7-apps' renderer 2.x stays and runs beside it.

## 0.6.2

- The HMI page template, its folder and the boot's copy of the HMI's widgets are made readable by the HMI's user (0644 files, 0755 folders) whatever umask the install or the boot runs with. An install that ran with umask 077 left the template readable by root only, and the HMI, which runs as its own user, showed the app's page empty. An install whose template is in place for its HmiMain3D makes it readable without making it again, and each boot copies it readable. (robertnisipeanu/mgu-store mgu-render 0.6.1, pull request #48.)
- Runs beside idrive7-apps' renderer: that one draws the idrive7-apps apps, mgu-render the Store. The touch divert's table and ports come from `touch_table` and `touch_port` (ours `ip mgu_render`, 30570 in and 30571 out; idrive7-apps' `ip idrive7_render`, 30572 and 30573), and on `lo` each lets the other's re-injections through.
- Other renderers are no longer set aside at install: unit files 0.5.3-0.6.1 moved to `/var/opt/mgu-renderd/retired/` go back (`mgu-render-restore.sh`, in place of `mgu-render-retire.sh`), so apps installed without the Store draw again from the next start.

## 0.6.1

- The kit's GPU renderer 2.x installed from the Store (idrive7-renderd 2.0, mgu-render itself under the old name, offered for a car whose screen does not show with this one) is no longer set aside at install: its owner chose it there. Uninstalling it in the Store gives the apps back to this renderer. The kit installer's `mgu-renderd.service` and an idrive7-renderd 1.x are still set aside.

## 0.6.0

- Page changes of an embed app show no black box: when the app says its HMI page changes (X_BRIDGE 1, caps 64), its frames show on a layer of the renderer's own over exactly the box, above the HMI, for `embed_bridge_ms` (400), while the HMI shows neither page. The layer goes at once on X_BRIDGE 0 (an HMI popup, menu or HOME took the page's focus), when another app comes in front, a camera or video surface shows, or the app leaves the box, hides, goes silent or disconnects. `embed_bridge = 0` turns it off; apps that do not send X_BRIDGE get no layer (README.md, "Page changes"). (robertnisipeanu/mgu-store pull request #47.)

## 0.5.4

- `fps` and `fps.<app>` (0): the frames a second an app that asks for a rate (FPS) gets, in place of the rate it asks; for every such app, or for one (`fps.robertn_store = 60`). Display-bridge apps ask for none and are not paced by it.
- While `/run/mgu-render/stats-log` exists, each step of an app's frames and touches goes to `/run/mgu-render/trace.log` (`<us> R <step> <n> <app>`, CLOCK_MONOTONIC): touch in and forwarded, TICK sent, frame received, draw start and end, commit, the HMI's frame callback; `tools/car-test/trace.js` lines it up with the Store's.
- (robertnisipeanu/mgu-store mgu-render 0.5.2, pull requests #45-#46.)

## 0.5.3

- The older GPU renderers are set aside at install (`mgu-render-retire.sh`, run by the new postInstall `mgu-render-install.sh` before the page template): idrive7-apps' `mgu-renderd.service` and `idrive7-renderd.service`, IterioDev's `mgu-renderd.service`. Their unit files move to `/var/opt/mgu-renderd/retired/`; nothing is stopped while the HMI runs, and from the next start mgu-render serves their apps (in their protocols) and the controller gate. Beside one of them the apps kept drawing through it, and the gate stayed connected to it.

## 0.5.2

- A zero-copy frame is committed once its GL commands are flushed (`glFlush`), relying on the GPU driver's implicit sync, so the renderer's loop is not held while the GPU draws; `embed_finish = 1` waits for the GPU (`glFinish`).
- A display-bridge app's frame (DOOM) on zero-copy is uploaded at its own size and scaled into the GPU buffer by GL, to the nearest pixel, black around it.
- While `/run/mgu-render/stats-log` exists, an embed app's stats line has the HMI's frame callbacks in that second and the time from commit to callback.

## 0.5.1

- iDrive 7 HmiMain3D builds whose page stays black with the template in place (MGU P18_23w44.2, MainApp 8.3.2 on a G20/G01) get no template and no marker: the Store and the apps draw in their own layer there. The list is NO_EMBED in mgu-render-hmi.sh.

## 0.5.0

- Embed frames are drawn straight into GPU buffers the HMI's compositor shows (zero-copy): three linear XRGB8888 dmabufs from GBM (`libgbm.so.1`, loaded when needed), each the texture of an FBO, given to the compositor with `wl_drm`'s `create_prime_buffer`. Used when the compositor offers `wl_drm` v2 with PRIME and XRGB8888 and the renderer's EGL imports dmabufs; otherwise frames are read back into its shared memory as before, and so until mgu-render restarts once the compositor refused the buffers (a `wl_drm` protocol error; mgu-render reconnects at once) or they could not be made. The journal says `embed: zero-copy` or `embed: readback fallback (<why>)`, and lists the compositor's globals. `embed_zero_copy = 0` reads back always.
- With zero-copy, display-bridge's apps' pixels go into the GPU buffers too (drawn by GL as a picture): the HMI's compositor shows a GPU buffer with red and blue swapped once the surface id has shown a shared-memory buffer in that HMI run.
- Embed frames are drawn top-down, so a readback is one copy (no rows turned); anti-aliased edges can differ from 0.4.0's by a few levels.
- `tick_early` (on): an embed app gets its TICK once its last frame is drawn and no drawn frame waits, so it builds frame N+1 while the HMI shows frame N; that frame is drawn while the compositor still has the one before and committed at its frame callback.
- `readback_pbo` (on): the readback goes through a pixel buffer (GLES 3) and is copied into the compositor's buffer just before that frame is committed.
- STATS has a fourth word for native apps (1: the frames were drawn zero-copy), X_READY's caps have 32 (embed zero-copy), and while `/run/mgu-render/stats-log` exists each shown app's frames a second, render time and frame path are logged once a second.

## 0.4.1

- The HMI page template is made when mgu-render is installed or updated (`mgu-render-hmi.sh --build`, the deploy tool's `postInstall`; needs mgu-deploy 0.6.1), at low priority for at most 120 s, never before the HMI: `mgu-render-hmi.service` only mounts a template made for the installed HmiMain3D, the generator and the surface id, else leaves the stock widgets, so the HMI and the cluster's map start without waiting for it. An install whose boot-time build never finished gets its template with this update; embed is offered from the next start of the head unit.
- `/var/opt/mgu-render/status.json` says how the last build went: `template` `ok`, `building` or `failed`, the `stamp` it was for, the `reason` and, when it failed, `problem` (`In-page drawing unavailable: <reason>`), which the Store shows on the Renderer's page (mgu-updater 0.8.1, Store 0.9.7). A build the generator refuses (identifiers it cannot find in this HmiMain3D) is not tried again until the stamp changes; any other failure (the time limit, a signal, memory or disk) is tried again at the next install.

## 0.4.0

- Video, from IterioDev mgu-renderd 1.2.0 protocol 4, for third-party apps in the iterio and native dialects: a player writes decoded frames (I420, up to 2048×2048, BT.601 or BT.709, limited or full range) to `/dev/shm/mgu-video-<name>` in up to four slots; the app names the file (VIDEO 13, DROP_VIDEO 14) and draws op 19 where the picture goes, fitted into the box with its aspect kept and a corner radius, under and over its other ops. Each new frame draws the app's last frame again without a message from the app; a shown app still sends at least one message a second, as IterioDev's kit does. Only `/dev/shm/mgu-video-*` regular files of the app's uid, root or `nobody` (IterioDev's mgu-ytplay) are opened (no links); others get an ERROR. A video counts w×h×3 bytes towards limits of its own, 12 MiB an app and 32 MiB all apps; a frame size past them is logged and the frame shown before stays. A frame the file is too short for draws the frame shown before, and the app is not redrawn for it until seq changes. READY's version is 4, X_READY's caps have 16 (video), and `js/mgu_render_client.js` has `video()` and `videoOp()`. Video streams from IterioDev's kit, which its YouTube app (IterioDev/car-apps) draws with, replay unchanged (`make test`).
## 0.3.3

- `gate_legacy = 0` by default: another renderer's apps (the idrive7-apps kit's mgu-renderd next to this one) are no longer hidden by the foreground gate - on a G20 they were hidden altogether.

## 0.3.2

- iDrive 7: apps may claim touch in the title strip too (`touch_area` 84,0,1836,720), where the idrive7-apps kit draws its page tabs.

## 0.3.1

- iDrive 8: an app's screens drawn by the renderer show there (the renderer finds which app is in front on its HMI).

## 0.3.0

- display-bridge's apps (mgu-apps DOOM, draw_gallery, display_bridge_demo) draw through mgu-render, unchanged: it speaks display-bridge's protocol DBR1 (`src/dbr.c`; a connection whose first bytes are its magic) on display-bridge's socket `/dev/shm/display-bridge/bridge.sock`, a link to its own while nothing else listens there. Their frames (INDEX8 with a palette, XRGB, ARGB, RGBA; whole or in regions) go into a pixmap drawn fitted into the HMI page's box as display-bridge places them, each answered PRESENTED or DROPPED; touch on the picture comes as their TOUCH in frame pixels.
- Embed mode draws a frame as soon as it comes and commits it at the compositor's next frame callback (four buffers), so a frame is ready the moment the HMI is; display-bridge's apps' frames are written into the buffer on the CPU, with no GL readback.
- display-bridge's own units (`display-bridge.socket`, `.service`, `-hmi.service`) stand down while mgu-render is installed (a drop-in with `ConditionPathExists=!/var/opt/mgu-render/current/mgu-render`, from the next head-unit start): one embed provider, one page template, one foreground gate. Uninstalling mgu-render removes the drop-ins.

## 0.2.0

- Its own socket, `/run/mgu-render/render.sock`. The community renderers' socket `/run/mgu-renderd/renderd.sock` is a link to it while no other renderer is installed (none of `shared_yield`'s unit files present): made by the socket unit at its start (`mgu-render --share`) and kept by the daemon every 2 s, removed when another renderer is installed, never replacing or removing anything that is not that link but a socket nobody listens on while no other renderer is installed (0.1's own, left when its socket unit restarts). Needs mgu-deploy 0.4.0. Upstream's and IterioDev's renderers take the path at their start; mgu-render takes it back once they are removed.
- Layer apps on ivi layer `0x4d520000 + slot` and surface `0x4d520100 + slot`, apart from the community renderers' `0x4d47…`.
- Touch divert in its own table `ip mgu_render`, ports 30570 in and 30571 out; on `lo` re-injections from IterioDev's renderer (30569) and ours (30571) go on to the HMI. The unit deletes only that table when it stops.
- The controller gate's event socket `@mgu-renderd-ccu` is bound only while an app grabs, and its file touched only while that socket is ours: upstream's renderer keeps the controller for its apps.
- An update leaves a running daemon running (`keepRunning`); the new version runs from its next start.
- `js/mgu_render_client.js` connects to the own socket, then to the community one when nothing listens there.
