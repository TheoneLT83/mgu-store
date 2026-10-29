#!/bin/sh
# The old GPU renderers, set aside at mgu-render's install: idrive7-apps' installer's (mgu-renderd.service),
# idrive7-renderd 1.x from its repository through the Store, and IterioDev's
# (mgu-renderd.service). mgu-render serves their apps in their own protocols; while their units exist it
# steps aside, so the apps would keep drawing through the old one, and the controller gate in the HMI keeps
# its connection to it. Their unit files move to /var/opt/mgu-renderd/retired/ (the same paths under it);
# nothing is stopped while the HMI runs (the gate talks to the renderer, and an HMI that aborts reboots the
# head unit): from the next start mgu-render serves the apps and the gate.
#   mgu-render-retire.sh          (component.json postInstall, through mgu-render-install.sh)
# idrive7-apps' renderer 2.x installed from the Store (idrive7-renderd, mgu-render itself under the old name, its
# touch divert in its own table and ports) stays: it runs beside this one.
# Undo: move the files in retired/ back and reboot.
S=${MGU_RENDER_SYSTEMD:-/etc/systemd/system}
B=${MGU_RENDER_RETIRED:-/var/opt/mgu-renderd/retired}
K=${MGU_RENDER_KIT:-/var/opt/idrive7-renderd/current/component.json}
OLD="$S/mgu-renderd.service $S/oapcontroller.service.wants/mgu-renderd.service"
kv=$(sed -n 's/.*"version"[^"]*"\([0-9]*\)\..*/\1/p' "$K" 2>/dev/null | head -n 1)
if [ -n "$kv" ] && [ "$kv" -ge 2 ]; then
    echo "mgu-render: the kit's GPU renderer $kv.x from the Store stays beside mgu-render"
else
    OLD="$OLD $S/idrive7-renderd.service $S/oapcontroller.service.wants/idrive7-renderd.service"
fi
any=0
for f in $OLD; do { [ -e "$f" ] || [ -L "$f" ]; } && any=1; done
[ $any = 1 ] || exit 0
RW=0
if ! { touch "$S/.mgu-rw" 2>/dev/null && rm -f "$S/.mgu-rw"; }; then
    mount -o remount,rw / && RW=1 || { echo "mgu-render: the old renderers stay (root file system not writable)"; exit 0; }
fi
mkdir -p "$B"
for f in $OLD; do
    d=$B${f#"$S"}
    { [ -e "$f" ] || [ -L "$f" ]; } && mkdir -p "${d%/*}" && cp -a "$f" "$d" && rm -f "$f" && echo "mgu-render: set aside $f (to $d)"
done
sync
[ $RW = 1 ] && mount -o remount,ro / 2>/dev/null
echo "mgu-render: serves the apps and the controller gate from the next head unit start"
exit 0
