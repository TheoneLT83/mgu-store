# app-privacy changelog

## 1.4.0

- iDrive 8: MainApp-21 (`/usr/lib/oap-mainapp21`) is patched too, at the next start of the head unit. Our apps are left out of its backend app inventory, app-repository queries and downloads, release-notes request, install/crash/start/stop analytics, corrupt-app reports and DiagOap readout. A crashed local-only app is only restarted, with the same 5 restarts in 10 minutes as on iDrive 7; one left stopped can be started again from its tile. On iDrive 8 the tool never asks for MainApp-21 to be restarted (`nextStart` in its JSON instead). iDrive 7 is unchanged.

## 1.3.0

- A local-only app that crashes is only restarted: its data is kept, it stays installed and its tile stays enabled. After 5 restarts in 10 minutes, the next crash leaves it stopped until it is started again (its tile, MainApp, or the next boot); deaths while the head unit shuts down do not count. Other apps keep MainApp's crash recovery.
