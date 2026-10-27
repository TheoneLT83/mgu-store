#!/bin/sh
# Runs the app-privacy tests on the head unit's Node (8.16.2), in Docker,
# with the repository's apps and, when present, the decoded oap-mainapp
# (iDrive 7) and MainApp-21 (iDrive 8).
set -e
cd "$(dirname "$0")/../../.."
FIRMWARE=${FIRMWARE_MAINAPP_DIR:-}
if [ -n "$FIRMWARE" ] && [ -d "$FIRMWARE/src" ]; then
    set -- -v "$FIRMWARE:/firmware:ro" -e FIRMWARE_MAINAPP_DIR=/firmware
fi
FIRMWARE21=${FIRMWARE_MAINAPP21_DIR:-}
if [ -n "$FIRMWARE21" ] && [ -d "$FIRMWARE21/src" ]; then
    set -- "$@" -v "$FIRMWARE21:/firmware21:ro" -e FIRMWARE_MAINAPP21_DIR=/firmware21
fi
docker run --rm -v "$PWD:/w:ro" -w /w "$@" node:8.16.2-stretch \
    node native/app-privacy/test/test_patch_mainapp.js
