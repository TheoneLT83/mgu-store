#!/bin/sh
# build/target/mgu-wpa, run in native/mgu-uplink inside the image of wpa/Dockerfile
# (Makefile): upstream 2.10 with wpa-mgu-sme-connect.patch and the options in wpa/config, for the
# unit's loader /lib/ld-linux-x86-64.so.2, then checked by wpa/check.sh. The same tree in the
# same image gives the same bytes.
set -eu
V=2.10
B=build/wpa
S=$B/wpa_supplicant-$V
rm -rf "$B"
mkdir -p "$B" build/target
tar -xzf "/src/wpa_supplicant-$V.tar.gz" -C "$B"
patch -s -p1 -d "$S" < wpa/wpa-mgu-sme-connect.patch
cp wpa/config "$S/wpa_supplicant/.config"
make -s -C "$S/wpa_supplicant" -j"$(nproc)" LIBNL_INC=/usr/include/libnl3 \
    LDFLAGS=-Wl,--dynamic-linker=/lib/ld-linux-x86-64.so.2 wpa_supplicant
strip -o build/target/mgu-wpa "$S/wpa_supplicant/wpa_supplicant"
sh wpa/check.sh build/target/mgu-wpa
