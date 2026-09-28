#!/usr/bin/env python3
"""Analyse the supplied audio once; the JSON belongs to this render only."""

import json
import sys

import librosa
import numpy as np


def main(source, destination):
    signal, rate = librosa.load(source, sr=22050, mono=True)
    if signal.size == 0:
        raise ValueError("audio is empty")
    hop = 512
    onset = librosa.onset.onset_strength(y=signal, sr=rate, hop_length=hop)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=rate, hop_length=hop, trim=False)
    beats = librosa.frames_to_time(frames, sr=rate, hop_length=hop).tolist()
    onsets = librosa.frames_to_time(
        librosa.onset.onset_detect(onset_envelope=onset, sr=rate, hop_length=hop),
        sr=rate, hop_length=hop
    ).tolist()
    rms = librosa.feature.rms(y=signal, hop_length=hop)[0]
    spectrum = np.abs(librosa.stft(signal, hop_length=hop))
    frequencies = librosa.fft_frequencies(sr=rate)
    bands = {}
    for name, low, high in (("low", 20, 250), ("mid", 250, 2000), ("high", 2000, 10000)):
        selected = spectrum[(frequencies >= low) & (frequencies < high)]
        bands[name] = selected.mean(axis=0).tolist() if selected.size else []
    grid = {
        "source": source, "duration": round(signal.size / rate, 6),
        "bpm": round(float(np.asarray(tempo).reshape(-1)[0]), 6),
        "beats": [round(value, 6) for value in beats],
        "downbeats": [round(value, 6) for value in beats[::4]],
        "onsets": [round(value, 6) for value in onsets],
        "hopSec": hop / rate,
        "rms": rms.tolist(), "bands": bands,
    }
    with open(destination, "w", encoding="utf-8") as stream:
        json.dump(grid, stream, separators=(",", ":"))
        stream.write("\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
