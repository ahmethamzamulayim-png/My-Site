"""Harder synthetic rides: a phone that gets bumped while the train stands at a
station, and a cheap sensor with a large bias. Each case once broke the
detector; these keep it from breaking again.

    python tests/test_robustness.py      (prints the error table)
"""

import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analysis.ride import analyse  # noqa: E402
from analysis.synth import RATE, make_ride  # noqa: E402

D = [1200, 900, 1500, 1100]
DWELLS = [30, 25, 35]
NET = {"stations": [{"name": f"S{i}", "km": sum(D[:i]) / 1000} for i in range(len(D) + 1)]}

# (name, sensor bias m/s^2, bump: (after which run, from s, to s into the dwell, amplitude m/s^2))
CASES = [
    ("clean", 0.03, None),
    ("bump 4s mid-dwell", 0.03, (0, 10, 14, 1.5)),
    ("bump 10s mid-dwell", 0.03, (1, 5, 15, 0.8)),  # used to bridge two runs into one
    ("bump 14s, ends 13s before departure", 0.03, (2, 8, 22, 0.8)),  # used to shift departure ~20 s early
    ("bump right before departure", 0.03, (2, 18, 32, 1.0)),
    ("sensor bias 0.3", 0.3, None),  # used to break stop detection entirely
]


def run_case(bias, bump, seed):
    df, truth = make_ride(D, DWELLS, seed=seed, bias=bias)
    if bump:
        k, a, b, amp = bump
        sl = slice(int((truth[k][1] + a) * RATE), int((truth[k][1] + b) * RATE))
        noise = np.random.default_rng(seed).normal(size=(sl.stop - sl.start, 3)) * amp
        for i, c in enumerate(c for c in df.columns if c.startswith("Linear")):
            df.loc[df.index[sl], c] += noise[:, i]
    with tempfile.TemporaryDirectory() as d:
        df.to_csv(Path(d) / "Raw Data.csv", index=False)
        (Path(d) / "ride.yaml").write_text("date: 2026-10-07\nboard: S0\nalight: S4\nstart_clock: '08:00:00'\n")
        ride = analyse(d, NET)
    return ride, truth


def errors(ride, truth):
    if len(ride.segments) != len(truth):
        return None
    time_err = max(max(abs(s.depart_s - t[0]), abs(s.arrive_s - t[1])) for s, t in zip(ride.segments, truth))
    dist_err = max(abs(s.integrated_m - t[2]) / t[2] for s, t in zip(ride.segments, truth))
    peak_err = max(abs(s.peak_kmh - t[3] * 3.6) for s, t in zip(ride.segments, truth))
    return time_err, dist_err, peak_err


def test_all_cases():
    for name, bias, bump in CASES:
        for seed in range(4):
            ride, truth = run_case(bias, bump, seed)
            e = errors(ride, truth)
            assert e is not None, f"{name} seed {seed}: {len(ride.segments)} runs, expected {len(truth)}"
            time_err, dist_err, peak_err = e
            assert time_err < 2.0, f"{name} seed {seed}: edge off by {time_err:.1f} s"
            assert dist_err < 0.05, f"{name} seed {seed}: distance off by {dist_err:.0%}"
            assert peak_err < 4.0, f"{name} seed {seed}: peak off by {peak_err:.1f} km/h"


if __name__ == "__main__":
    print(f"{'case':<38} {'seed':>4} {'edge err s':>10} {'dist err':>9} {'peak err km/h':>14}")
    for name, bias, bump in CASES:
        for seed in range(4):
            e = errors(*run_case(bias, bump, seed))
            print(f"{name:<38} {seed:>4} " + ("  wrong number of runs" if e is None else f"{e[0]:>10.1f} {e[1]:>9.1%} {e[2]:>14.1f}"))
    test_all_cases()
    print("ok test_all_cases")
