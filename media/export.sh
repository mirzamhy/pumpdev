#!/usr/bin/env bash
# Turns the HyperFrames renders in out/ into small web loops + posters in apps/web/public/media.
# Run after: npx hyperframes@0.8.186 render <dir> -o out/<dir>.mp4   (dir = hero, flow, patterns)
set -euo pipefail
cd "$(dirname "$0")"
DEST=../apps/web/public/media
mkdir -p "$DEST"

web() { # input, output name, optional crop filter, scale width
  local in=$1 name=$2 vf=$3
  ffmpeg -y -loglevel error -i "$in" -an -vf "$vf" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -profile:v high -movflags +faststart "$DEST/$name.mp4"
  ffmpeg -y -loglevel error -ss 2 -i "$in" -frames:v 1 -vf "$vf" -q:v 4 "$DEST/$name.jpg"
}

web out/hero.mp4 hero "scale=1200:-2"
web out/flow.mp4 flow "scale=1600:-2"
web out/patterns.mp4 pattern-runner "crop=800:360:0:0"
web out/patterns.mp4 pattern-recycler "crop=800:360:800:0"
web out/patterns.mp4 pattern-rugger "crop=800:360:1600:0"
ls -la "$DEST"
