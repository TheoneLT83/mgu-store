# mgu-deploy runs this with sh from the tool's current/ (postInstall: install, preUninstall: uninstall)
exec /usr/bin/node "$(dirname "$0")/multitouch.js" "$@"
