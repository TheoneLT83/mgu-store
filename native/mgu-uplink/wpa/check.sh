#!/bin/sh
# Checks that BINARY (wpa_supplicant) loads on the head unit: ELF64 x86-64, loader
# /lib/ld-linux-x86-64.so.2 (the unit has no /lib64), only libraries the unit has, and only
# symbol versions they define: glibc up to 2.27, libnl 3.2.29's, OpenSSL 1.1.1w's.
set -eu
B=$1
fail=0
readelf -h "$B" | grep -q 'Class:.*ELF64' && readelf -h "$B" | grep -q 'Machine:.*X86-64' || { echo "FAIL  not ELF64 x86-64"; fail=1; }
interp=$(readelf -l "$B" | sed -n 's/.*Requesting program interpreter: \(.*\)]/\1/p')
[ "$interp" = /lib/ld-linux-x86-64.so.2 ] || { echo "FAIL  interpreter '$interp'"; fail=1; }
needed=$(readelf -d "$B" | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p' | sort | tr '\n' ' ')
for n in $needed; do
    case $n in
    libnl-3.so.200|libnl-genl-3.so.200|libcrypto.so.1.1|librt.so.1|libpthread.so.0|libdl.so.2|libc.so.6) ;;
    *) echo "FAIL  needs $n"; fail=1 ;;
    esac
done
for v in $(objdump -T "$B" | grep -oE '(GLIBC_[0-9A-Z.]+|OPENSSL_[0-9]_[0-9a-z_]+|libnl_[0-9_]+)( |$)' | sort -u); do
    case $v in
    GLIBC_2.*) [ "$(printf '%s\n%s\n' "$v" GLIBC_2.27 | sort -V | tail -1)" = GLIBC_2.27 ] || { echo "FAIL  needs $v"; fail=1; } ;;
    libnl_3|libnl_3_2_2[6-9]) ;;
    OPENSSL_1_1_0|OPENSSL_1_1_0[acdfghij]|OPENSSL_1_1_1|OPENSSL_1_1_1[bcdeh]) ;;
    *) echo "FAIL  needs $v"; fail=1 ;;
    esac
done
[ $fail = 0 ] && echo "OK    $B: x86-64, $interp, needs $needed($(wc -c < "$B") bytes)"
exit $fail
