#!/bin/sh
# mgu-render's install step (component.json postInstall, run as root from current/): the old renderers set
# aside (mgu-render-retire.sh), then the HMI page template made (mgu-render-hmi.sh --build).
cd "$(dirname "$0")" || exit 1
sh ./mgu-render-retire.sh
exec sh ./mgu-render-hmi.sh --build "$@"
