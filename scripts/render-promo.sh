#!/usr/bin/env bash
# Renders site/promo/index.html into site/promo/promo.mp4 (1920x1080, 30 fps, 46 s) frame by frame with
# headless Chrome, then muxes the voice-over if site/promo/voice.mp3 exists (ElevenLabs output of voiceover.md).
#   scripts/render-promo.sh            # full render
#   scripts/render-promo.sh 10 14      # only seconds 10-14 (quick check)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
FPS=30
FROM="${1:-0}"
TO="${2:-46}"
OUT=site/promo/frames
mkdir -p "$OUT"
PAGE="file://$PWD/site/promo/index.html"

n=$(python3 -c "print(int((${TO}-${FROM})*${FPS}))")
echo "rendering ${n} frames (${FROM}-${TO} s) with ${CHROME}"
for ((i = 0; i < n; i++)); do
  t=$(python3 -c "print(round(${FROM} + ${i}/${FPS}, 4))")
  f=$(printf "%s/f%05d.png" "$OUT" "$i")
  [ -s "$f" ] && continue
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=2500 \
    --screenshot="$f" "$PAGE?t=$t" >/dev/null 2>&1
  (( i % 60 == 0 )) && echo "  $i / $n"
done

ffmpeg -y -loglevel error -framerate $FPS -i "$OUT/f%05d.png" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart site/promo/promo-silent.mp4
echo "video: site/promo/promo-silent.mp4"

# Audio: bgm.mp3 comes from scripts/make-bgm.py; voice.mp3 from ElevenLabs (voiceover.md).
# With both, the music ducks under the voice (sidechain) and sits about 14 dB below it.
V=site/promo/voice.mp3
B=site/promo/bgm.mp3
if [ -s "$V" ] && [ -s "$B" ]; then
  ffmpeg -y -loglevel error -i site/promo/promo-silent.mp4 -i "$B" -i "$V" \
    -filter_complex "[1:a]volume=0.32[bg];[2:a]aformat=channel_layouts=stereo,volume=1.0[vo];[vo]asplit[vo1][vo2];[bg][vo1]sidechaincompress=threshold=0.04:ratio=6:attack=25:release=500[duck];[duck][vo2]amix=inputs=2:normalize=0:duration=first[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -shortest site/promo/promo.mp4
  echo "with voice + music: site/promo/promo.mp4"
elif [ -s "$B" ]; then
  ffmpeg -y -loglevel error -i site/promo/promo-silent.mp4 -i "$B" -filter_complex "[1:a]volume=0.9[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -shortest site/promo/promo.mp4
  echo "with music (no voice yet): site/promo/promo.mp4"
  echo "voice: generate site/promo/voice.mp3 from site/promo/voiceover.md with ElevenLabs, then rerun"
else
  cp site/promo/promo-silent.mp4 site/promo/promo.mp4
  echo "silent: run scripts/make-bgm.py for music, add site/promo/voice.mp3 for the voice-over"
fi
