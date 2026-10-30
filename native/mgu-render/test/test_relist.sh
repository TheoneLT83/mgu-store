#!/bin/sh
# src/relist.c against a stand-in for Winston's layer list (test/mock_winston.c), where each connection's add_layer
# rewrites the screen's list from its own copy: three long-lived clients, the HMI (layer 100), our renderer and
# another renderer (0x4d470000).
#  - add_layer on our long-open connection drops the other renderer's layer (the stand-in behaves as Winston does);
#  - relist_put puts our layer on top and keeps every other layer;
#  - a layer dropped by another program's add_layer is reported to its owner (screen none), and relist_put puts it
#    back without dropping that program's layer;
#  - a renderer connected before the HMI's layer existed drops it with its own add_layer; relist_put keeps it.
set -eu
B=$1
T=$(mktemp -d)
pids=
trap 'for p in $pids; do kill $p 2>/dev/null || true; done; rm -rf "$T"' EXIT
export XDG_RUNTIME_DIR=$T WAYLAND_DISPLAY=w0
pass=0
ok() { if eval "$2"; then pass=$((pass + 1)); else echo "FAIL: $1"; echo "order: $(order)"; exit 1; fi; }

"$B/mock_winston" w0 > "$T/winston.log" &
pids="$pids $!"
i=0; while ! grep -q ready "$T/winston.log"; do i=$((i + 1)); [ $i -lt 50 ] || { echo "FAIL: no mock compositor"; exit 1; }; sleep 0.1; done

# say NAME CMD...: send commands, then wait until the client has done them
say() {
	n=$1; shift
	for c in "$@"; do echo "$c"; done >> "$T/$n.q"
	echo sync >> "$T/$n.q"
	k=$(grep -c synced "$T/$n.out" 2>/dev/null) || k=0
	cat "$T/$n.q" > "$T/$n.pipe"; : > "$T/$n.q"
	i=0; while [ "$(grep -c synced "$T/$n.out" 2>/dev/null || true)" -le "$k" ]; do
		i=$((i + 1)); [ $i -lt 100 ] || { echo "FAIL: $n did not answer"; cat "$T/$n.out"; exit 1; }; sleep 0.05
	done
}
order() { grep '^order' "$T/winston.log" | tail -n 1 | sed 's/^order *//'; }
client() {
	mkfifo "$T/$1.pipe"
	# a reader that outlives each writer: the fifo is reopened for every batch of commands
	( while :; do cat "$T/$1.pipe"; done ) | "$B/ivi_client" > "$T/$1.out" 2>&1 &
	pids="$pids $!"
	i=0; while ! grep -q ready "$T/$1.out" 2>/dev/null; do   # its copy of the list is taken by now
		i=$((i + 1)); [ $i -lt 100 ] || { echo "FAIL: $1 did not connect"; cat "$T/$1.out"; exit 1; }; sleep 0.05
	done
}

# a renderer that connects before the HMI has its layer (as one started with the compositor, at boot)
client early
client hmi
say hmi 'layer 100' 'add 100' commit
ok 'the HMI puts its layer on the screen' '[ "$(order)" = "0x64" ]'

client ours
client other
say other 'layer 0x4d470000' 'add 0x4d470000' commit
ok 'another renderer adds its layer' '[ "$(order)" = "0x64 0x4d470000" ]'

say ours 'layer 0x4d520000' 'add 0x4d520000' commit
ok 'add_layer on a connection open since before drops the other layer' '[ "$(order)" = "0x64 0x4d520000" ]'
ok 'the other renderer hears its layer left the screen' 'grep -q "ev 0x4d470000 screen none" "$T/other.out"'

say other 'add 0x4d470000' commit
ok 'the other renderer puts its layer back from its own copy, dropping ours' '[ "$(order)" = "0x64 0x4d470000" ]'
ok 'we hear our layer left the screen' 'grep -q "ev 0x4d520000 screen none" "$T/ours.out"'

heard=$(grep -c "ev 0x4d470000" "$T/other.out")
say ours 'put 0x4d520000'
ok 'relist_put: ours on top, the other renderer and the HMI kept' '[ "$(order)" = "0x64 0x4d470000 0x4d520000" ]'
ok 'relist_put answers ok' 'grep -q "put ok" "$T/ours.out"'
ok 'we hear our layer is on the screen again' '[ "$(grep "ev 0x4d520000" "$T/ours.out" | tail -n 1)" = "ev 0x4d520000 screen set" ]'
ok 'the other renderer heard nothing about its layer' '[ "$(grep -c "ev 0x4d470000" "$T/other.out")" = "$heard" ]'

say ours 'layer 0x4d520001' 'put 0x4d520001'
ok 'a second layer of ours goes on top, nothing dropped' '[ "$(order)" = "0x64 0x4d470000 0x4d520000 0x4d520001" ]'

say ours 'destroy 0x4d520001' commit
ok 'destroying a layer of ours leaves the rest' '[ "$(order)" = "0x64 0x4d470000 0x4d520000" ]'

say early 'layer 0x4d470001' 'add 0x4d470001' commit
ok 'a renderer connected before the HMI layer drops it with add_layer (the black display)' '[ "$(order)" = "0x4d470001" ]'
say early 'destroy 0x4d470001' commit
say hmi 'order 100' commit
say early 'layer 0x4d470002' 'put 0x4d470002'
ok 'relist_put from that renderer keeps the HMI layer' '[ "$(order)" = "0x64 0x4d470002" ]'

echo "test_relist: $pass passed"
