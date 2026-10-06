"""Generate a fake ride with known answers, in phyphox's export format.

Used by the tests: the analysis must recover the departure/arrival times and
speeds this file put in. It is NOT a model of the real M4 - the station
distances and speeds below are round numbers, not measurements.

    python -m analysis.synth rides/_synthetic
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

RATE = 100  # Hz, like a real phone


def trapezoid_run(distance_m: float, v_max: float = 22.0, accel: float = 1.0, decel: float = 1.0) -> np.ndarray:
    """Along-track acceleration for one run: speed up, cruise, brake to a stop."""
    t_acc, t_dec = v_max / accel, v_max / decel
    d_ramp = v_max * (t_acc + t_dec) / 2
    if d_ramp > distance_m:  # too short to reach v_max
        v_max = np.sqrt(2 * distance_m * accel * decel / (accel + decel))
        t_acc, t_dec = v_max / accel, v_max / decel
        d_ramp = distance_m
    t_cruise = (distance_m - d_ramp) / v_max
    n = lambda s: int(round(s * RATE))  # noqa: E731
    return np.concatenate([np.full(n(t_acc), accel), np.zeros(n(t_cruise)), np.full(n(t_dec), -decel)])


def random_rotation(rng: np.random.Generator) -> np.ndarray:
    q, r = np.linalg.qr(rng.normal(size=(3, 3)))
    return q * np.sign(np.diag(r))


def make_ride(distances_m: list[float], dwells_s: list[float], seed: int = 0, bias: float = 0.03,
              lead_s: float = 20.0, tail_s: float = 15.0, gravity: bool = False, vert_sine: float = 0.0):
    """Return (phyphox-style DataFrame, truth list of (depart_s, arrive_s, distance_m, peak_ms)).

    gravity=True adds the app's gravity columns; vert_sine adds a 6 Hz vertical
    vibration of that amplitude (m/s^2) while moving - known inputs for the
    comfort tests."""
    rng = np.random.default_rng(seed)
    along, moving, truth = [np.zeros(int(lead_s * RATE))], [np.zeros(int(lead_s * RATE), bool)], []
    t = lead_s
    for k, d in enumerate(distances_m):
        a = trapezoid_run(d)
        dur = len(a) / RATE
        peak = float(np.max(np.cumsum(a) / RATE))
        truth.append((t, t + dur, d, peak))
        along.append(a)
        moving.append(np.ones(len(a), bool))
        t += dur
        wait = dwells_s[k] if k < len(dwells_s) else tail_s
        along.append(np.zeros(int(wait * RATE)))
        moving.append(np.zeros(int(wait * RATE), bool))
        t += wait
    along, moving = np.concatenate(along), np.concatenate(moving)
    n = len(along)

    # train frame: x along track, y sideways, z up. Vibration only while moving.
    vib = np.where(moving, 0.18, 0.015)[:, None] * rng.normal(size=(n, 3))
    sway = np.where(moving, 1, 0) * 0.08 * np.sin(2 * np.pi * 0.7 * np.arange(n) / RATE)
    vert = np.where(moving, 1, 0) * vert_sine * np.sin(2 * np.pi * 6.0 * np.arange(n) / RATE)
    train = np.column_stack([along, sway, vert]) + vib
    rot = random_rotation(rng)
    phone = train @ rot.T + bias  # phone sits at an unknown angle; sensor has a constant bias

    time = np.arange(n) / RATE
    df = pd.DataFrame({
        "Time (s)": time,
        "Linear Acceleration x (m/s^2)": phone[:, 0],
        "Linear Acceleration y (m/s^2)": phone[:, 1],
        "Linear Acceleration z (m/s^2)": phone[:, 2],
    })
    df["Absolute acceleration (m/s^2)"] = np.linalg.norm(phone, axis=1)
    if gravity:
        g = np.array([0.0, 0.0, 9.81]) @ rot.T  # gravity is "up" in the train frame, seen through the phone's tilt
        for i, a in enumerate("xyz"):
            df[f"Gravity {a} (m/s^2)"] = g[i]
    return df, truth


def app_samples(out: Path, board: str, alight: str, network: Path, seed: int = 7) -> None:
    """Samples for tests/app_e2e.mjs: a ride between two real stations, at 50 Hz like a phone."""
    import json
    km = {s["name"]: s["km"] for s in json.loads(network.read_text())["stations"]}
    names = list(km)
    i, j = names.index(board), names.index(alight)
    hops = names[i : j + 1] if i < j else names[j : i + 1][::-1]
    dists = [abs(km[b] - km[a]) * 1000 for a, b in zip(hops, hops[1:])]
    df, truth = make_ride(dists, [30, 25, 35, 28, 32][: len(dists) - 1], seed=seed, bias=0.05,
                          gravity=True, vert_sine=0.3)
    df = df.iloc[::2]
    cols = [c for c in df.columns if c.startswith("Linear")]
    gcols = [c for c in df.columns if c.startswith("Gravity")]
    out.write_text(json.dumps({"t": df["Time (s)"].round(4).tolist(), "a": df[cols].round(5).values.tolist(),
                               "g": df[gcols].round(4).values.tolist(), "truth": truth}))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--app-samples", nargs=2, metavar=("BOARD", "ALIGHT"),
                   help="write JSON samples for the app's browser test instead (uses network/m4.json)")
    args = p.parse_args(argv)
    if args.app_samples:
        app_samples(Path(args.out), *args.app_samples, Path(__file__).resolve().parents[1] / "network" / "m4.json", args.seed)
        return
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    df, truth = make_ride([1200, 900, 1500, 1100], [30, 25, 35], seed=args.seed)
    df.to_csv(out / "Raw Data.csv", index=False)
    (out / "ride.yaml").write_text(
        "date: 2026-10-07\nline: M4\ndirection: Synthetic End\nboard: S0\nalight: S4\n"
        "phone_position: lap-flat\nstart_clock: '08:00:00'\nnotes: synthetic test ride\n"
    )
    for dep, arr, d, peak in truth:
        print(f"run {dep:7.1f} -> {arr:7.1f} s  {d:6.0f} m  peak {peak * 3.6:5.1f} km/h")


if __name__ == "__main__":
    main()
