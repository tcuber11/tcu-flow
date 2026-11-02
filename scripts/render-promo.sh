#!/usr/bin/env bash
# Renders site/promo/index.html into site/promo/promo.mp4 (1920x1080, 30 fps, 46 s) frame by frame with
# headless Chrome, then muxes the voice-over if site/promo/voice.mp3 exists (ElevenLabs output of voiceover.md).
#   scripts/render-promo.sh            # full render
#   scripts/render-promo.sh 10 14      # only seconds 10–14 (quick check)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
FPS=30
FROM="${1:-0}"
TO="${2:-46}"
OUT=site/promo/frames
mkdir -p "$OUT"
PAGE="file://$PWD/site/promo/index.html"

n=$(python3 -c "print(int(($TO-$FROM)*$FPS))")
echo "rendering $n frames ($FROM–$TO s) with $CHROME"
for ((i = 0; i < n; i++)); do
  t=$(python3 -c "print(round($FROM + $i/$FPS, 4))")
  f=$(printf "%s/f%05d.png" "$OUT" "$i")
  [ -s "$f" ] && continue
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=2500 \
    --screenshot="$f" "$PAGE?t=$t" >/dev/null 2>&1
  (( i % 60 == 0 )) && echo "  $i / $n"
done

ffmpeg -y -loglevel error -framerate $FPS -i "$OUT/f%05d.png" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart site/promo/promo-silent.mp4
echo "video: site/promo/promo-silent.mp4"

if [ -s site/promo/voice.mp3 ]; then
  ffmpeg -y -loglevel error -i site/promo/promo-silent.mp4 -i site/promo/voice.mp3 -c:v copy -c:a aac -b:a 160k -shortest site/promo/promo.mp4
  echo "with voice: site/promo/promo.mp4"
else
  echo "no site/promo/voice.mp3 yet: generate it from site/promo/voiceover.md with ElevenLabs, then rerun"
fi
