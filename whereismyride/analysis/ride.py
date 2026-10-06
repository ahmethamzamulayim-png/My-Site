"""Analyse one recorded ride: when did the train stop and go, how fast did it
move between stations, and how far was each departure from the timetable.

    python -m analysis.ride rides/2026-10-07_0812_kadikoy

The ride folder holds the phyphox export (CSV files or the .zip) plus a
ride.yaml (see rides/_example/ride.yaml).

Method, and why:
- Stops are found from how much the phone is shaking, not from speed. A train
  standing at a platform is far quieter than one moving (rail vibration) or
  accelerating/braking (~1 m/s^2 sustained). That needs no integration, so it
  has no drift.
- Speed IS integrated, but only between two stops. A phone accelerometer has a
  small constant bias; integrated over a whole ride it grows into nonsense.
  Between two stops the speed is known to be zero at both ends, so the bias
  can be solved for exactly and removed.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yaml
from scipy.signal import butter, sosfiltfilt

from .comfort import run_comfort, train_axes
from .load import load_phyphox

ACTIVITY_WINDOW_S = 3.0  # rolling window for "how much is the phone shaking"
MIN_STOP_S = 8.0  # stationary stretches shorter than this are merged into motion (crawl, jolt lull)
MIN_RUN_S = 15.0  # moving stretches shorter than this are merged into a stop (someone bumped the phone)


@dataclass
class Segment:
    """One run between two stops."""

    depart_s: float  # seconds since recording start
    arrive_s: float
    from_station: str | None = None
    to_station: str | None = None
    track_m: float | None = None  # along-track distance, from the network file
    integrated_m: float | None = None  # distance from integrating the accelerometer - a quality check
    avg_kmh: float | None = None
    peak_kmh: float | None = None
    bias_ms2: float | None = None  # accelerometer bias removed on this segment
    profile: list[tuple[float, float]] = field(default_factory=list)  # (t since depart, km/h), 1 Hz
    comfort: dict = field(default_factory=dict)  # see analysis/comfort.py

    @property
    def run_s(self) -> float:
        return self.arrive_s - self.depart_s


def _lowpass(x: np.ndarray, rate: float, cutoff_hz: float) -> np.ndarray:
    sos = butter(2, cutoff_hz, fs=rate, output="sos")
    return sosfiltfilt(sos, x)


def activity(df: pd.DataFrame, rate: float) -> np.ndarray:
    """How much the phone is shaking: rolling standard deviation, summed over the axes.

    Standard deviation, not mean magnitude: a sensor's constant bias shifts
    the mean (a 0.1 m/s^2 bias on a cheap phone was enough to drown the
    stopped/moving difference) but leaves the variation untouched.
    """
    win = max(2, int(ACTIVITY_WINDOW_S * rate))
    var = sum(df[c].fillna(0).rolling(win, center=True, min_periods=2).var().fillna(0) for c in ("ax", "ay", "az"))
    return np.sqrt(var.to_numpy())


def _otsu_threshold(x: np.ndarray) -> float:
    """Split values into two groups with the least within-group variance (Otsu's method)."""
    hist, edges = np.histogram(x, bins=256)
    centers = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centers) / np.maximum(w0, 1)
    m1 = (np.sum(hist * centers) - np.cumsum(hist * centers)) / np.maximum(w1, 1)
    between = w0 * w1 * (m0 - m1) ** 2
    return float(centers[np.argmax(between)])


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) index pairs of consecutive True values."""
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def detect_runs(df: pd.DataFrame, rate: float) -> list[tuple[float, float]]:
    """(depart_s, arrive_s) for every run between stops."""
    act = activity(df, rate)
    # threshold on log scale: stopped and moving differ by a factor, not an offset
    log_act = np.log10(np.maximum(act, 1e-4))
    moving = log_act > _otsu_threshold(log_act)

    # clean up: drop short blips inside a stop (phone bumped) first, so a bump in the
    # middle of a dwell can't leave two short lulls that then get bridged into one long run;
    # then fill short lulls inside a run (a smooth stretch of track, a slow crawl)
    for start, end in _runs(moving):
        if (end - start) / rate < MIN_RUN_S:
            moving[start:end] = False
    for start, end in _runs(~moving):
        if (end - start) / rate < MIN_STOP_S and start > 0 and end < len(moving):
            moving[start:end] = True

    t = df.index.to_numpy()
    return [(float(t[s]), float(t[e - 1])) for s, e in _runs(moving)]


def longitudinal_axis(df: pd.DataFrame, rate: float, runs: list[tuple[float, float]]) -> np.ndarray:
    """Unit vector (in phone coordinates) pointing along the track.

    Accelerating and braking are the biggest *sustained* accelerations in a
    ride, and both act along the track - so the main direction of the
    low-passed acceleration while moving is the track direction.
    """
    acc = np.column_stack([_lowpass(df[c].fillna(0).to_numpy(), rate, 0.5) for c in ("ax", "ay", "az")])
    t = df.index.to_numpy()
    mask = np.zeros(len(t), bool)
    for dep, arr in runs:
        mask |= (t >= dep) & (t <= arr)
    if mask.sum() < rate * 10:
        mask[:] = True
    a = acc[mask]
    _, _, vt = np.linalg.svd(a - a.mean(axis=0), full_matrices=False)
    return vt[0]


def speed_profile(df: pd.DataFrame, rate: float, axis: np.ndarray, dep: float, arr: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Speed (m/s) over one run, with the accelerometer bias removed.

    Returns (time since depart, speed, bias). The bias is the constant that
    makes the speed end at zero, which it must: the train is stopped at both
    ends of the run.
    """
    t = df.index.to_numpy()
    sel = (t >= dep) & (t <= arr)
    a = np.column_stack([df[c].fillna(0).to_numpy()[sel] for c in ("ax", "ay", "az")]) @ axis
    a = _lowpass(a, rate, 1.0)
    dt = 1.0 / rate
    v = np.cumsum(a) * dt
    duration = len(a) * dt
    bias = v[-1] / duration  # constant acceleration error that explains the leftover speed
    v = v - bias * np.arange(1, len(a) + 1) * dt
    # sign: whichever way the phone faces, the train speeds up first, so speed is mostly positive
    if np.trapezoid(v, dx=dt) < 0:
        v = -v
        bias = -bias
    return t[sel] - dep, v, bias


def refine_edges(df: pd.DataFrame, rate: float, axis: np.ndarray, dep: float, arr: float,
                 push_ms2: float = 0.35, hold_s: float = 3.0, calm_ms2: float = 0.08) -> tuple[float, float]:
    """Move a run's edges to where the train actually starts and stops moving.

    Shaking marks a run only roughly: the smoothing window blurs the edges by a
    second or two, and a passenger bumping the phone just before departure gets
    glued onto the run. What a bump can't fake is the train's own push: a
    sustained ~1 m/s^2 along the track for several seconds when it pulls away,
    and the same backwards when it brakes. So: find the first sustained forward
    push and the last sustained braking, then walk outwards to where the
    along-track acceleration was last calm.
    """
    t = df.index.to_numpy()
    pad = 5.0  # look slightly outside the detected run, in case it was cut short
    sel = (t >= dep - pad) & (t <= arr + pad)
    ts = t[sel]
    a = np.column_stack([df[c].fillna(0).to_numpy()[sel] for c in ("ax", "ay", "az")]) @ axis
    a = _lowpass(a, rate, 0.3)
    a -= np.median(a)  # bias: the train spends most of a run cruising, near zero acceleration
    if np.argmax(a) > np.argmin(a):  # phone axis points backwards: make speeding up positive
        a = -a
    hold = int(hold_s * rate)

    def sustained(mask: np.ndarray) -> np.ndarray:
        run = np.convolve(mask.astype(int), np.ones(hold, int), mode="valid")
        return np.flatnonzero(run == hold)

    push, brake = sustained(a > push_ms2), sustained(a < -push_ms2)
    if len(push) == 0 or len(brake) == 0:
        return dep, arr
    i, j = push[0], brake[-1] + hold - 1
    calm_before = np.flatnonzero(np.abs(a[:i]) < calm_ms2)
    calm_after = np.flatnonzero(np.abs(a[j:]) < calm_ms2)
    start = calm_before[-1] if len(calm_before) else 0
    end = j + calm_after[0] if len(calm_after) else len(a) - 1
    return float(ts[start]), float(ts[end])


@dataclass
class Ride:
    folder: Path
    meta: dict
    segments: list[Segment]
    warnings: list[str]
    start_clock: datetime | None

    def wall(self, seconds: float) -> datetime | None:
        return self.start_clock + timedelta(seconds=seconds) if self.start_clock else None


def _start_clock(meta: dict) -> datetime | None:
    clock, date = meta.get("start_clock"), meta.get("date")
    if not clock or not date:
        return None
    return datetime.fromisoformat(f"{date}T{clock}")


def _station_sequence(meta: dict, network: dict | None) -> tuple[list[dict], list[str]]:
    """Stations from board to alight, in travel order, from the network file."""
    if not network:
        return [], ["no network file - stations not labelled (run network/fetch_network.py)"]
    names = [s["name"] for s in network["stations"]]
    try:
        i, j = names.index(meta["board"]), names.index(meta["alight"])
    except (KeyError, ValueError) as e:
        return [], [f"board/alight not found in network file: {e}"]
    seq = network["stations"][i : j + 1] if i <= j else network["stations"][j : i + 1][::-1]
    return seq, []


def _read_meta(path: Path) -> dict:
    """ride.yaml next to the CSVs, or inside the .zip the app shares."""
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.endswith("ride.yaml")]
            return yaml.safe_load(z.read(names[0])) if names else {}
    f = path / "ride.yaml"
    return yaml.safe_load(f.read_text()) if f.exists() else {}


def analyse(folder: str | Path, network: dict | None = None) -> Ride:
    folder = Path(folder)
    meta = _read_meta(folder)
    df = load_phyphox(folder)
    rate = 1.0 / float(np.median(np.diff(df.index.to_numpy())))

    runs = detect_runs(df, rate)
    axis = longitudinal_axis(df, rate, runs)
    stations, warnings = _station_sequence(meta, network)
    if stations and len(runs) != len(stations) - 1:
        warnings.append(
            f"detected {len(runs)} runs but {meta.get('board')} -> {meta.get('alight')} is "
            f"{len(stations) - 1} stations: station labels skipped. Check for an unscheduled stop "
            "in a tunnel, or a missed short run."
        )
        stations = []

    axes3 = train_axes(df, axis)
    segments = []
    for k, (dep, arr) in enumerate(runs):
        dep, arr = refine_edges(df, rate, axis, dep, arr)
        tt, v, bias = speed_profile(df, rate, axis, dep, arr)
        seg = Segment(depart_s=dep, arrive_s=arr, bias_ms2=round(float(bias), 4))
        seg.integrated_m = round(float(np.trapezoid(v, tt)), 1)
        seg.peak_kmh = round(float(v.max() * 3.6), 1)
        seg.profile = [(round(float(x), 1), round(float(y * 3.6), 1)) for x, y in zip(tt[:: int(rate)], v[:: int(rate)])]
        if stations:
            a, b = stations[k], stations[k + 1]
            seg.from_station, seg.to_station = a["name"], b["name"]
            if a.get("km") is not None and b.get("km") is not None:
                seg.track_m = round(abs(b["km"] - a["km"]) * 1000, 1)
        seg.comfort = run_comfort(df, rate, axis, dep, arr, axes3)
        dist = seg.track_m if seg.track_m else seg.integrated_m
        seg.avg_kmh = round(dist / seg.run_s * 3.6, 1) if seg.run_s > 0 else None
        segments.append(seg)

    return Ride(folder, meta, segments, warnings, _start_clock(meta))


def compare_timetable(ride: Ride, timetable: dict) -> list[dict]:
    """Each measured departure vs. the nearest scheduled one at that station.

    The timetable is minute-precision (HH:MM), so a deviation inside +/-30 s
    can't be told apart from on time. That's a limit of the published data,
    not of the measurement.
    """
    direction = ride.meta.get("direction")
    rows = []
    for seg in ride.segments:
        when = ride.wall(seg.depart_s)
        if not (when and seg.from_station):
            continue
        by_dir = timetable.get("stations", {}).get(seg.from_station, {})
        # the API's direction names may be longer than what I typed ("Kadıköy" vs "Tavşantepe - Kadıköy")
        key = direction if direction in by_dir else next((k for k in by_dir if direction and direction.lower() in k.lower()), None)
        times = by_dir.get(key, [])
        sched = [datetime.combine(when.date(), datetime.strptime(x, "%H:%M").time()) for x in times]
        if not sched:
            rows.append({"station": seg.from_station, "measured": when.strftime("%H:%M:%S"), "scheduled": None, "deviation_s": None})
            continue
        nearest = min(sched, key=lambda s: abs((when - s).total_seconds()))
        rows.append({
            "station": seg.from_station,
            "measured": when.strftime("%H:%M:%S"),
            "scheduled": nearest.strftime("%H:%M"),
            "deviation_s": round((when - nearest).total_seconds()),
        })
    return rows


def _fmt(s: float) -> str:
    return f"{int(s // 60)}:{s % 60:04.1f}"


def report(ride: Ride, tt_rows: list[dict] | None = None) -> str:
    lines = [f"Ride: {ride.folder.name}  ({ride.meta.get('board', '?')} -> {ride.meta.get('alight', '?')})", ""]
    lines.append(f"{'#':>2}  {'from':<22} {'depart':>9} {'run':>7} {'dwell':>6} {'avg':>6} {'peak':>6} {'dist chk':>9}")
    for k, s in enumerate(ride.segments):
        dwell = s.depart_s - ride.segments[k - 1].arrive_s if k else None
        wall = ride.wall(s.depart_s)
        dep = wall.strftime("%H:%M:%S") if wall else _fmt(s.depart_s)
        chk = f"{s.integrated_m / s.track_m:.0%}" if s.track_m else "-"
        lines.append(
            f"{k + 1:>2}  {(s.from_station or '-'):<22} {dep:>9} {_fmt(s.run_s):>7} "
            f"{(f'{dwell:.0f}s' if dwell is not None else '-'):>6} {s.avg_kmh or 0:>5.1f}  {s.peak_kmh:>5.1f}  {chk:>9}"
        )
    lines.append("")
    lines.append("avg/peak in km/h. 'dist chk' = integrated distance / track distance; near 100% means the")
    lines.append("speed profile can be trusted, far off means the phone moved or the axis was misjudged.")
    if ride.segments and ride.segments[0].comfort:
        lines += ["", "Ride comfort (ISO 2631-1 weighted vibration; jerk = how abruptly the push changes):",
                  f"{'#':>2}  {'from':<22} {'traction':>8} {'braking':>8} {'jerk go':>8} {'jerk stop':>9} {'vib':>6}  feels"]
        for k, s in enumerate(ride.segments):
            c = s.comfort
            lines.append(f"{k + 1:>2}  {(s.from_station or '-'):<22} {c['traction_peak_ms2']:>8.2f} {c['braking_peak_ms2']:>8.2f} "
                         f"{c['jerk_start_ms3']:>8.2f} {c['jerk_stop_ms3']:>9.2f} {c['aw_total']:>6.3f}  {c['comfort']}")
        lines.append("traction/braking m/s^2, jerk m/s^3, vib = weighted RMS m/s^2. Phone on a lap/in a bag reads lower")
        lines.append("than a seat-mounted sensor: compare rides with the same phone_position, don't quote as ISO figures.")
        if "axes_note" in ride.segments[0].comfort:
            lines.append("(" + ride.segments[0].comfort["axes_note"] + ")")
    if tt_rows:
        lines += ["", "vs. timetable (timetable is HH:MM only, so +/-30 s is 'on time'):"]
        for r in tt_rows:
            dev = f"{r['deviation_s']:+d} s" if r["deviation_s"] is not None else "no scheduled time"
            lines.append(f"  {r['station']:<22} measured {r['measured']}  scheduled {r['scheduled'] or '-':>5}  {dev}")
    for w in ride.warnings:
        lines.append(f"! {w}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("ride", help="ride folder (phyphox export + ride.yaml), or a .zip shared from the app")
    p.add_argument("--network", help="default: network/<line>.json, else that line from network/lines.json")
    p.add_argument("--timetable", help="timetable JSON for that day (default: timetable/<date>.json if present)")
    p.add_argument("--json", action="store_true", help="print machine-readable output instead of the table")
    args = p.parse_args(argv)

    network = None
    if args.network:
        network = json.loads(Path(args.network).read_text())
    else:
        line = (_read_meta(Path(args.ride)).get("line") or "M4")
        here = Path(__file__).resolve().parents[1] / "network"
        if (here / f"{line.lower()}.json").exists():
            network = json.loads((here / f"{line.lower()}.json").read_text())
        elif (here / "lines.json").exists():
            network = next((l for l in json.loads((here / "lines.json").read_text())["lines"] if l["line"] == line), None)
    ride = analyse(args.ride, network)

    tt_path = Path(args.timetable) if args.timetable else Path("timetable") / f"{ride.meta.get('date')}.json"
    tt_rows = compare_timetable(ride, json.loads(tt_path.read_text())) if tt_path.exists() else None

    if args.json:
        json.dump({"meta": ride.meta, "segments": [s.__dict__ for s in ride.segments],
                   "timetable": tt_rows, "warnings": ride.warnings}, sys.stdout, indent=1, default=str)
    else:
        print(report(ride, tt_rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
