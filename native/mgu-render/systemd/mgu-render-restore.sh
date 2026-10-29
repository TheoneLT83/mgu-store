#!/bin/sh
# The other GPU renderers run beside mgu-render (idrive7-apps' renderer draws its apps, mgu-render the Store): unit
# files that mgu-render 0.5.3-0.6.1 set aside at its install (mgu-render-retire.sh, into
# /var/opt/mgu-renderd/retired/, the same paths under it) go back where they were, unless one is there again.
# Nothing is started: they run from the next head unit start.
#   mgu-render-restore.sh          (component.json postInstall, through mgu-render-install.sh)
S=${MGU_RENDER_SYSTEMD:-/etc/systemd/system}
B=${MGU_RENDER_RETIRED:-/var/opt/mgu-renderd/retired}
[ -d "$B" ] || exit 0
todo=$(cd "$B" && find . \( -type f -o -type l \) 2>/dev/null)
[ -n "$todo" ] || exit 0
RW=0
if ! { touch "$S/.mgu-rw" 2>/dev/null && rm -f "$S/.mgu-rw"; }; then
    mount -o remount,rw / && RW=1 || { echo "mgu-render: the set-aside renderers stay aside (root file system not writable)"; exit 0; }
fi
for rel in $todo; do
    f=$S/${rel#./}
    if [ -e "$f" ] || [ -L "$f" ]; then
        rm -f "$B/${rel#./}"
    else
        mkdir -p "${f%/*}" && cp -a "$B/${rel#./}" "$f" && rm -f "$B/${rel#./}" && echo "mgu-render: put back $f"
    fi
done
find "$B" -depth -type d -empty -delete 2>/dev/null
sync
[ $RW = 1 ] && mount -o remount,ro / 2>/dev/null
systemctl daemon-reload 2>/dev/null
echo "mgu-render: the other renderers run beside it from the next head unit start"
exit 0
