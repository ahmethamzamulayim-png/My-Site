"""Ride comfort per run: how hard the train pushes, how abruptly, and how much it shakes.

Three kinds of number, each answering a different passenger complaint:

1. Longitudinal (along the track) - "the start threw me backwards"
   - peak traction / braking acceleration, m/s^2
   - peak jerk, m/s^3: how fast the acceleration changes. A smooth start and a
     lurching one can reach the same acceleration; jerk is what separates them.
     Reported separately for pulling away, braking, and the final stop (the
     lurch when the brakes release), where it is usually worst.

2. Vibration - "it's a rough ride"
   - frequency-weighted RMS acceleration per ISO 2631-1: vertical weighted with
     Wk, horizontal with Wd, because people feel 4-8 Hz up-and-down and 1-2 Hz
     side-to-side most. Combined into one vector value (seated comfort: k = 1
     on every axis) and mapped to ISO 2631-1 Annex C's comfort words.

3. Per stretch of track - "this bit is always bumpy"
   - the same weighted RMS, kept per run, so the same stretch can be compared
     across rides, days and trains. A stretch that gets worse over weeks is a
     maintenance signal.

HONEST LIMITS - read before quoting a number:
- ISO 2631-1 measures at the seat surface with a fixed accelerometer. A phone on
  a lap or in a bag is softened by the body/bag, so absolute values here are NOT
  ISO compliance figures. Comparisons are valid when the phone sits the same way
  (same `phone_position`), which is why rides record it.
- Phones sample at ~50-100 Hz, so vibration above half the sample rate (25 Hz
  at 50 Hz) is not seen. Train ride vibration sits mostly below that; the
  weighting itself is exact up to that limit (applied in the frequency domain).
- Vertical vs. horizontal needs the gravity direction. The app records it; a
  phyphox "without g" export doesn't, and then only the orientation-free total
  and the longitudinal numbers are reported.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import signal

# ISO 2631-1:1997 Annex A, Table A.2 - weighting filter parameters (Hz, Q)
_WEIGHTS = {
    "Wk": dict(f1=0.4, f2=100.0, f3=12.5, f4=12.5, q4=0.63, f5=2.37, q5=0.91, f6=3.35, q6=0.91),
    "Wd": dict(f1=0.4, f2=100.0, f3=2.0, f4=2.0, q4=0.63, f5=None, q5=None, f6=None, q6=None),
}

# ISO 2631-1 Annex C: likely reactions to overall vibration in public transport (ranges overlap in the standard)
COMFORT_SCALE = [
    (0.315, "not uncomfortable"),
    (0.63, "a little uncomfortable"),
    (1.0, "fairly uncomfortable"),
    (1.6, "uncomfortable"),
    (2.5, "very uncomfortable"),
    (float("inf"), "extremely uncomfortable"),
]


def iso_weighting(name: str):
    """ISO 2631-1 weighting as an analog transfer function H(s) = num(s) / den(s).

    Product of the standard's stages: band-limiting high-pass (f1) and low-pass
    (f2), acceleration-velocity transition (f3, f4, Q4) and, for Wk, the upward
    step (f5, Q5, f6, Q6). Checked against the standard's tabulated weighting
    factors in tests/test_comfort.py.
    """
    p = _WEIGHTS[name]
    w = lambda f: 2 * np.pi * f  # noqa: E731
    num, den = np.array([1.0]), np.array([1.0])
    # band limiting: 2nd-order Butterworth high-pass at f1, low-pass at f2
    num = np.polymul(num, [1.0, 0.0, 0.0])
    den = np.polymul(den, [1.0, w(p["f1"]) * np.sqrt(2), w(p["f1"]) ** 2])
    num = np.polymul(num, [w(p["f2"]) ** 2])
    den = np.polymul(den, [1.0, w(p["f2"]) * np.sqrt(2), w(p["f2"]) ** 2])
    # acceleration-velocity transition: (1 + s/w3) / (1 + s/(Q4 w4) + s^2/w4^2)
    w3, w4, q4 = w(p["f3"]), w(p["f4"]), p["q4"]
    num = np.polymul(num, np.array([1.0 / w3, 1.0]) * w4 ** 2)
    den = np.polymul(den, [1.0, w4 / q4, w4 ** 2])
    # upward step (Wk): (s^2 + s w5/Q5 + w5^2) / (s^2 + s w6/Q6 + w6^2) - gain (f5/f6)^2 = 0.5 low, 1 high
    if p["f5"]:
        w5, w6, q5, q6 = w(p["f5"]), w(p["f6"]), p["q5"], p["q6"]
        num = np.polymul(num, [1.0, w5 / q5, w5 ** 2])
        den = np.polymul(den, [1.0, w6 / q6, w6 ** 2])
    return num, den


def weighting_gain(name: str, f) -> np.ndarray:
    """|H(j 2 pi f)| of the ISO weighting at frequencies f (Hz)."""
    num, den = iso_weighting(name)
    jw = 2j * np.pi * np.asarray(f, dtype=float)
    return np.abs(np.polyval(num, jw) / np.polyval(den, jw))


def weighted_rms(x: np.ndarray, fs: float, name: str) -> float:
    """Frequency-weighted RMS acceleration (m/s^2).

    The weighting is applied in the frequency domain (FFT x exact |H|), not with
    a digital filter: a bilinear-transformed filter bends the response near the
    Nyquist frequency, and phones sample low enough (often 50 Hz) for that to
    matter - it cost up to 60% at 20 Hz in testing. Content above Nyquist is
    simply not seen; a train's ride vibration sits mostly below 20 Hz.
    """
    n = len(x)
    if n < fs:  # under a second: not meaningful
        return float("nan")
    x = (x - np.mean(x)) * signal.windows.tukey(n, 0.1)  # taper the ends so the cut doesn't add a fake click
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / fs)
    y = np.fft.irfft(spec * weighting_gain(name, f), n)
    power_kept = np.mean(signal.windows.tukey(n, 0.1) ** 2)  # undo the taper's energy loss
    return float(np.sqrt(np.mean(y ** 2) / power_kept))


def comfort_word(a_v: float) -> str:
    for limit, word in COMFORT_SCALE:
        if a_v < limit:
            return word
    return COMFORT_SCALE[-1][1]


def train_axes(df: pd.DataFrame, longitudinal: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """(longitudinal, lateral, vertical) unit vectors in phone coordinates.

    Vertical = the average gravity direction (needs the app's gravity columns).
    Longitudinal is made exactly perpendicular to it; lateral completes the set.
    """
    if not {"gx", "gy", "gz"} <= set(df.columns) or df[["gx", "gy", "gz"]].isna().all().all():
        return None
    g = df[["gx", "gy", "gz"]].mean().to_numpy()
    if np.linalg.norm(g) < 5:  # not a gravity vector; something's wrong with the data
        return None
    up = g / np.linalg.norm(g)
    lon = longitudinal - np.dot(longitudinal, up) * up
    if np.linalg.norm(lon) < 0.3:  # track axis came out almost vertical - can't separate
        return None
    lon /= np.linalg.norm(lon)
    lat = np.cross(up, lon)
    return lon, lat, up


def run_comfort(df: pd.DataFrame, fs: float, axes_lon: np.ndarray, dep: float, arr: float,
                axes3=None) -> dict:
    """Comfort numbers for one run (depart -> arrive)."""
    t = df.index.to_numpy()
    sel = (t >= dep) & (t <= arr)
    acc = np.column_stack([df[c].fillna(0).to_numpy()[sel] for c in ("ax", "ay", "az")])
    out: dict = {}

    # --- longitudinal: smooth to 1 Hz first, otherwise "jerk" is just rail vibration differentiated
    lon = acc @ axes_lon
    lon_s = signal.sosfiltfilt(signal.butter(2, 1.0, fs=fs, output="sos"), lon)
    lon_s -= np.median(lon_s)  # bias: a run is mostly cruising
    if np.argmax(lon_s) > np.argmin(lon_s):  # make "speeding up" positive
        lon_s = -lon_s
    jerk = np.gradient(lon_s, 1 / fs)
    n = len(jerk)
    edge = min(int(10 * fs), n // 3)  # first / last 10 s of the run
    out["traction_peak_ms2"] = round(float(lon_s.max()), 2)
    out["braking_peak_ms2"] = round(float(-lon_s.min()), 2)
    out["jerk_start_ms3"] = round(float(np.abs(jerk[:edge]).max()), 2) if edge else None
    out["jerk_stop_ms3"] = round(float(np.abs(jerk[-edge:]).max()), 2) if edge else None
    out["jerk_peak_ms3"] = round(float(np.abs(jerk).max()), 2)

    # --- vibration, ISO 2631-1 weighted
    if axes3 is not None:
        lo, la, up = axes3
        aw_x = weighted_rms(acc @ lo, fs, "Wd")
        aw_y = weighted_rms(acc @ la, fs, "Wd")
        aw_z = weighted_rms(acc @ up, fs, "Wk")
        a_v = float(np.sqrt(aw_x ** 2 + aw_y ** 2 + aw_z ** 2))
        out.update(aw_long=round(aw_x, 3), aw_lat=round(aw_y, 3), aw_vert=round(aw_z, 3))
    else:
        # no gravity direction: weight every axis with Wd (the more conservative of the two below 2 Hz)
        a_v = float(np.sqrt(sum(weighted_rms(acc[:, i], fs, "Wd") ** 2 for i in range(3))))
        out["axes_note"] = "no gravity data: vertical/lateral not separated, all axes Wd-weighted"
    out["aw_total"] = round(a_v, 3)
    out["comfort"] = comfort_word(a_v)
    return out
