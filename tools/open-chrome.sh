#!/usr/bin/env bash
# Open the memorial in a separate Chrome profile that uses the GPU (Wayland).
# The machine's main Chrome runs on X11 and falls back to llvmpipe (software WebGL).
URL="${1:-http://127.0.0.1:3100}"
PROFILE="${XDG_CACHE_HOME:-$HOME/.cache}/vinhthanh-3d-chrome"
mkdir -p "$PROFILE"
exec google-chrome --user-data-dir="$PROFILE" --no-first-run \
  --ozone-platform=wayland --ignore-gpu-blocklist --enable-gpu-rasterization "$URL"
