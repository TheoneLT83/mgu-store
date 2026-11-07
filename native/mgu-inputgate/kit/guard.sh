#!/bin/sh
# Controller gate (mgu-inputgate): boot guard for mgu-inputgate.so in hmi.service, from its repository's
# mgu-repo.json, installed by mgu-deploy (after idrive7-apps' deploy/mgu-app-install.sh inputgate).
D=/var/opt/mgu-inputgate; SO=$D/current/mgu-inputgate.so; RUN=/run/mgu-inputgate.env; PID=/run/mgu-inputgate.pid; N=$D/strikes; MAX=2
n=$(cat "$N" 2>/dev/null); case "$n" in ''|*[!0-9]*) n=0;; esac
# a version installed since the count was kept starts it again
v=$(readlink "$D/current" 2>/dev/null)
if [ "$(cat "$D/strikes.version" 2>/dev/null)" != "$v" ]; then n=0; echo 0 > "$N"; echo "$v" > "$D/strikes.version"; fi
other_preload() {   # the unit's LD_PRELOAD without ours; the last assignment wins, as in systemd
    systemctl cat hmi.service --no-pager 2>/dev/null | awk '
        /^# \// { ours = index($0, "mgu-inputgate") > 0; next }
        ours { next }
        /^[ \t]*Environment=/ && index($0, "LD_PRELOAD=") {
            v = substr($0, index($0, "LD_PRELOAD=") + 11)
            q = index(v, "\""); if (q) v = substr(v, 1, q - 1)
            last = v
        }
        END { print last }' | tr ':' ' ' | tr ' ' '\n' | grep -v '^$' | grep -v 'mgu-inputgate' | tr '\n' ' ' | sed 's/ $//'
}
case "${1:-}" in
boot)
    rm -f "$RUN"
    [ -f "$SO" ] || exit 0
    if [ "$n" -ge $MAX ]; then
        echo "mgu-inputgate left out: HmiMain3D did not come up healthy with it $n times in a row (remove and install it again to retry)"
        exit 0
    fi
    echo $((n + 1)) > "$N"; sync
    other=$(other_preload)
    echo "LD_PRELOAD=${other:+$other }$SO" > "$RUN"
    ;;
check)   # (mgu-inputgate-check.service, after hmi.service) the process has run with the library long enough
    # the first process seen with the library, for the stop: one that crashed and came back is another
    rm -f "$PID"; t=0
    while [ $t -lt 120 ]; do
        p=$(pidof HmiMain3D 2>/dev/null | cut -d' ' -f1)
        if [ -n "$p" ] && grep -q "mgu-inputgate.so" "/proc/$p/maps" 2>/dev/null; then echo "$p" > "$PID"; break; fi
        sleep 5; t=$((t + 5))
    done
    [ $t -lt 120 ] && sleep $((120 - t))
    p=$(pidof HmiMain3D 2>/dev/null | cut -d' ' -f1)
    if [ -n "$p" ] && grep -q "mgu-inputgate.so" "/proc/$p/maps" 2>/dev/null && systemctl is-active -q hmi.service; then
        up=$(cut -d. -f1 /proc/uptime); st=$(cut -d')' -f2 "/proc/$p/stat" | awk '{print $20}')
        if [ $((up - st / 100)) -ge 60 ]; then echo 0 > "$N"; sync; echo "mgu-inputgate: HmiMain3D healthy with it"; fi
    fi
    # never exit: the head unit's lifecycle reboots the unit when a service stops
    while :; do sleep 86400; done
    ;;
stop)   # (mgu-inputgate-check.service stopped, at a normal shutdown, before hmi.service) that process still runs with the library
    p=$(cat "$PID" 2>/dev/null)
    if [ -n "$p" ] && grep -q "mgu-inputgate.so" "/proc/$p/maps" 2>/dev/null && systemctl is-active -q hmi.service; then
        echo 0 > "$N"; sync; echo "mgu-inputgate: HmiMain3D ran with it until the shutdown"
    fi
    ;;
esac
exit 0
