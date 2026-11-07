# mgu-inputgate: the controller gate

Lets an app drawn by a renderer have the iDrive controller to itself while its screen shows: the knob, its press
and its tilt go to the app (the page's tabs, buttons and settings), not to the HMI. BACK, MENU and the touchscreen
are never taken. The Store's renderer (`mgu-render`) holds the controller for an app that asks (GRAB), and offers it
only where this gate is loaded in the HMI (`info.controller`): apps drawn with the idrive7-apps kit then run their
screen with the controller, among them Cluster functions.

It is idrive7-apps' controller gate (`kit/renderd/inputgate/`, MIT; its vsomeip headers MPL-2.0), built here the
same way: `src/mgu-inputgate.cpp`, compiled in the head unit's userland (Ubuntu 18.04, glibc 2.27, GCC 7), gives
the library idrive7-apps ships, byte for byte. Its install kit (`kit/`) is the one the updater makes for
idrive7-apps' `mgu-inputgate` (`native/mgu-updater/js/sources.js` `preloadFiles`), file for file
(`test/kit_test.js`), so whichever source installed it, the head unit has the same gate and either source updates
it. A car without idrive7-apps gets it from this repository.

## How it works

`mgu-inputgate.so` is loaded into the HMI (`HmiMain3D`) with `LD_PRELOAD` and hooks CommonAPI-SomeIP's
`Connection::handleProxyReceive`. While the gate is closed it rewrites FrontCCU's `RotaryEncoderStateFront` event
for the HMI alone (knob still, not pressed, centred) and hands the real event to the renderer over the abstract
socket `@mgu-renderd-ccu`. It is closed only while `/run/mgu-renderd/inputgate` is fresh, which the renderer touches
while an app holds the controller; a renderer gone leaves it stale, and the HMI has the controller back within
0.7 s.

## Install

| Path | |
|---|---|
| `/var/opt/mgu-inputgate/<version>/mgu-inputgate.so`, `guard.sh` | the library and its boot guard |
| `mgu-inputgate-guard.service` | before `hmi.service`: writes `/run/mgu-inputgate.env` (`LD_PRELOAD`, the unit's other preloads kept) unless the HMI failed to come up healthy with the library twice in a row |
| `mgu-inputgate-check.service` | after `hmi.service`: once `HmiMain3D` has run with it 60 s (checked 120 s after the start), the count starts again; so it does at a normal shutdown while the `HmiMain3D` that first loaded it still runs it, so a start ended within those minutes is no failure |
| `hmi.service.d/zz-mgu-inputgate.conf` | pulls both in and reads the env file |

Nothing restarts at the install: the HMI loads it at the next start of the head unit. A version installed since the
count was kept, or a removal and install, starts the count again. iDrive 7 only.

## Build and test

```sh
make target     # build/target/mgu-inputgate.so (Docker)
make test       # the install kit against the updater's
```

## License

MIT (`LICENSE`, idrive7-apps' controller gate); the vsomeip headers (`vsomeip-include/`) MPL-2.0, as each file says.
