#!/usr/bin/env python3
"""Synthesises the promo's background music into site/promo/bgm.wav (46 s, 44.1 kHz, stereo).

Pure Python, no dependencies: deterministic, so the same file comes out every run and we own
the rights. Warm lo-fi: a soft pad on C - G - Am - F, a plucked arpeggio, sub bass and light
drums that enter with the pairing scene (5 s) and leave before the closing card (42 s).
render-promo.sh mixes it under the voice-over (ducked) or alone.

    python3 scripts/make-bgm.py && ffmpeg -i site/promo/bgm.wav -b:a 160k site/promo/bgm.mp3
"""
import array
import math
import random
import wave

SR = 44100
LENGTH = 46.0
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
DRUMS_IN, DRUMS_OUT = 5.0, 42.0

random.seed(7)
N = int(SR * LENGTH)
left = [0.0] * N
right = [0.0] * N


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def add(buf_l, buf_r, start, samples, gain_l=1.0, gain_r=1.0):
    i0 = int(start * SR)
    for k, v in enumerate(samples):
        i = i0 + k
        if i >= N:
            break
        buf_l[i] += v * gain_l
        buf_r[i] += v * gain_r


# Chords as MIDI notes (C4 = 60): C, G, Am, F; bass roots an octave or two below.
CHORDS = [
    ([60, 64, 67], 36),
    ([59, 62, 67], 43),
    ([57, 60, 64], 45),
    ([57, 60, 65], 41),
]


def pad_bar(notes):
    """One bar of pad: three notes, each two slightly detuned sines plus a quiet 2nd harmonic."""
    n = int(BAR * SR) + int(0.25 * SR)  # overlaps the next bar a little
    out = [0.0] * n
    for m in notes:
        f = hz(m)
        for det in (-0.35, 0.35):
            w = 2 * math.pi * (f + det) / SR
            w2 = 2 * w
            ph = random.random() * 6.28
            for i in range(n):
                out[i] += math.sin(w * i + ph) + 0.18 * math.sin(w2 * i + ph)
    att = int(0.6 * SR)
    rel = int(0.25 * SR)
    for i in range(n):
        g = 1.0
        if i < att:
            g = i / att
        if i > n - rel:
            g = min(g, (n - i) / rel)
        out[i] *= g / (len(notes) * 2 * 1.18)
    return out


def pluck(midi, dur=0.45):
    f = hz(midi)
    n = int(dur * SR)
    w = 2 * math.pi * f / SR
    out = [0.0] * n
    for i in range(n):
        env = math.exp(-i / (SR * 0.12))
        out[i] = (math.sin(w * i) + 0.35 * math.sin(2 * w * i) * env + 0.12 * math.sin(3 * w * i) * env) * env
    return out


def bass(midi, dur=0.5):
    f = hz(midi)
    n = int(dur * SR)
    w = 2 * math.pi * f / SR
    out = [0.0] * n
    for i in range(n):
        a = min(1.0, i / (0.01 * SR))
        env = a * math.exp(-i / (SR * 0.35))
        out[i] = (math.sin(w * i) + 0.2 * math.sin(2 * w * i)) * env
    return out


def kick():
    n = int(0.22 * SR)
    out = [0.0] * n
    ph = 0.0
    for i in range(n):
        t = i / SR
        f = 48 + 110 * math.exp(-t * 28)
        ph += 2 * math.pi * f / SR
        out[i] = math.sin(ph) * math.exp(-t * 11) * 0.9
    return out


def hat(soft):
    n = int(0.045 * SR)
    out = [0.0] * n
    prev = 0.0
    lp = 0.0
    for i in range(n):
        white = random.uniform(-1, 1)
        hp = white - prev  # crude high-pass
        prev = white
        lp += 0.55 * (hp - lp)  # one-pole low-pass takes the fizz off
        out[i] = lp * math.exp(-i / (SR * 0.012)) * (0.09 if soft else 0.15)
    return out


def rim():
    n = int(0.09 * SR)
    out = [0.0] * n
    w = 2 * math.pi * 185 / SR
    for i in range(n):
        env = math.exp(-i / (SR * 0.025))
        out[i] = (random.uniform(-1, 1) * 0.5 + math.sin(w * i) * 0.5) * env * 0.35
    return out


bars = int(math.ceil(LENGTH / BAR))
pad_cache = {}
for b in range(bars):
    notes, root = CHORDS[b % 4]
    t0 = b * BAR
    key = tuple(notes)
    if key not in pad_cache:
        pad_cache[key] = pad_bar(notes)
    add(left, right, t0, pad_cache[key], 0.42, 0.42)

    # Arpeggio: eighth notes walking up the chord and back, an octave up, slight velocity swing.
    arp = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[0] + 24, notes[2] + 12, notes[1] + 12, notes[0] + 12, notes[2]]
    for s in range(8):
        t = t0 + s * BEAT / 2
        if t >= LENGTH:
            break
        vel = 0.16 if s % 2 == 0 else 0.11
        pan = 0.5 + 0.3 * math.sin(s * 0.9 + b)
        add(left, right, t, pluck(arp[s]), vel * (1 - pan) * 2, vel * pan * 2)

    # Bass on 1, the "and" of 2, and 3.
    for beat_pos in (0.0, 1.5, 2.0):
        t = t0 + beat_pos * BEAT
        if DRUMS_IN - BAR <= t < DRUMS_OUT:
            add(left, right, t, bass(root), 0.5, 0.5)

    # Drums between DRUMS_IN and DRUMS_OUT.
    for s in range(8):
        t = t0 + s * BEAT / 2
        if not (DRUMS_IN <= t < DRUMS_OUT):
            continue
        add(left, right, t, hat(s % 2 == 1), 0.5, 0.65)
        if s in (0, 4):
            add(left, right, t, kick(), 0.6, 0.6)
        if s in (2, 6):
            add(left, right, t, rim(), 0.6, 0.45)

# Master: fade in over the first second, fade out over the last three, soft clip, 16-bit.
fade_in = int(1.0 * SR)
fade_out = int(3.0 * SR)
peak = max(max(map(abs, left)), max(map(abs, right))) or 1.0
norm = 0.85 / peak
pcm = array.array("h")
for i in range(N):
    g = norm
    if i < fade_in:
        g *= i / fade_in
    if i > N - fade_out:
        g *= (N - i) / fade_out
    for v in (left[i] * g, right[i] * g):
        v = math.tanh(v * 1.1)
        pcm.append(int(max(-1.0, min(1.0, v)) * 32767))

with wave.open("site/promo/bgm.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote site/promo/bgm.wav (%.0f s)" % LENGTH)
