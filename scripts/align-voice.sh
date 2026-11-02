#!/usr/bin/env bash
# Lines up the ElevenLabs voice-over with the promo's scenes. Eleven v3 ignores <break> tags, so the
# raw take runs its sentences back to back; this cuts it at the pauses between scenes and places each
# piece at its scene's start. One CUTS/STARTS pair per language; edit it when the take changes:
#   CUTS    where the raw take pauses between scenes (seconds), found with
#           ffmpeg -i site/promo/voice-raw.mp3 -af silencedetect=noise=-32dB:d=0.18 -f null -
#   STARTS  where each piece should begin in the video (scene starts, a touch early)
#   scripts/align-voice.sh        # Indonesian: voice-raw.mp3 -> voice.mp3
#   scripts/align-voice.sh en     # English:    voice-en-raw.mp3 -> voice-en.mp3
set -euo pipefail
cd "$(dirname "$0")/.."
LANG_TAG="${1:-id}"
case "$LANG_TAG" in
  id) RAW=site/promo/voice-raw.mp3; OUT=site/promo/voice.mp3; CUTS=(0 5.0 12.42 20.5 26.96 35.53 999); STARTS=(0.2 5.4 13.9 22.2 29.8 38.6) ;;
  en) RAW=site/promo/voice-en-raw.mp3; OUT=site/promo/voice-en.mp3; CUTS=(0 5.67 13.1 19.3 27.0 36.1 999); STARTS=(0.2 5.9 13.9 22.2 30.0 39.2) ;;
  *) echo "usage: $0 [id|en]"; exit 2 ;;
esac
[ -s "$RAW" ] || { echo "missing $RAW"; exit 1; }

filter=""
mix=""
n=${#STARTS[@]}
for ((i = 0; i < n; i++)); do
  ms=$(python3 -c "print(int(${STARTS[$i]}*1000))")
  filter+="[0:a]atrim=${CUTS[$i]}:${CUTS[$((i + 1))]},asetpts=PTS-STARTPTS,adelay=${ms}:all=1[s$i];"
  mix+="[s$i]"
done
filter+="${mix}amix=inputs=${n}:normalize=0:duration=longest[a]"
ffmpeg -y -loglevel error -i "$RAW" -filter_complex "$filter" -map "[a]" -b:a 160k "$OUT"
echo "aligned: $OUT ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s)"
