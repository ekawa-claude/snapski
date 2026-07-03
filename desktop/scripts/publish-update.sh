#!/usr/bin/env bash
# Build the desktop NSIS installer and publish it to the SnapSki auto-update
# feed on the Oracle VM (served by Caddy at https://chat.wishly.wtf/snapski/).
#
# Run from WSL on the home PC (needs cmd.exe interop for the Windows build and
# `ssh laptop` configured; the VM is reached via the laptop hop). Bump the
# version in package.json BEFORE running, or electron-updater won't see it as new.
#
#   ./scripts/publish-update.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
echo "==> Publishing SnapSki $VER"

# 1) Build (Windows toolchain via cmd.exe). Kill any running instance first —
#    a live SnapSki.exe locks d3dcompiler_47.dll and electron-builder fails.
taskkill.exe /F /IM SnapSki.exe >/dev/null 2>&1 || true
cmd.exe /c "npx electron-vite build && npx electron-builder --win nsis zip --publish never"

EXE="SnapSki-Setup-$VER.exe"
VM_KEY='~/Downloads/ssh-key-2026-06-04.key'
VM='ubuntu@92.5.28.168'
DEST='/var/www/snapski'

# 2) Stage on the laptop, then push to the VM. Upload the installer + blockmap
#    first and latest.yml LAST, so a client never sees a version whose binary
#    isn't fully in place yet.
cd dist
scp -q "$EXE" "$EXE.blockmap" latest.yml laptop:/tmp/
ssh laptop "K=$VM_KEY; \
  scp -q -i \$K /tmp/'$EXE' /tmp/'$EXE.blockmap' $VM:$DEST/ && \
  scp -q -i \$K /tmp/latest.yml $VM:$DEST/"

echo "==> Done. Feed: https://chat.wishly.wtf/snapski/latest.yml"
curl -sS https://chat.wishly.wtf/snapski/latest.yml || true
