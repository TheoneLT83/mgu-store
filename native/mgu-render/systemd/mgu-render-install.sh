#!/bin/sh
# mgu-render's install step (component.json postInstall, run as root from current/): renderers an earlier
# version set aside put back (mgu-render-restore.sh), then the HMI page template made (mgu-render-hmi.sh --build).
cd "$(dirname "$0")" || exit 1
sh ./mgu-render-restore.sh
exec sh ./mgu-render-hmi.sh --build "$@"
