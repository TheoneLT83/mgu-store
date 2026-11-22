# Changelog

## 1.0.2

- Switches a car whose updater has saved its sources (every car that has run the Store): the Store's own
  source in `sources.json` reads TheoneLT83/mgu-store too, as the updater takes it over `builtin_repo`.
  Removing the tool puts back the repo it read before.

## 1.0.1

- Installs on the head unit's Node 8 (1.0.0 failed: `activate exited 1`, its folder made with an option Node 8
  does not have).

## 1.0.0

- The Store's own source becomes TheoneLT83/mgu-store from the next start (`builtin_repo` in the updater's
  `updater.local.conf`); removing the tool switches back.
