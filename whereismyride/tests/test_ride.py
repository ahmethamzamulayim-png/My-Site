"""Self-check: the analysis must recover what the synthetic ride put in.

    python -m pytest tests          (or: python tests/test_ride.py)
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analysis.ride import analyse, compare_timetable  # noqa: E402
from analysis.synth import make_ride  # noqa: E402

DISTANCES = [1200, 900, 1500, 1100]
NETWORK = {"line": "TEST", "stations": [
    {"name": f"S{i}", "km": sum(DISTANCES[:i]) / 1000} for i in range(len(DISTANCES) + 1)
]}


def _ride(tmp: Path, seed: int):
    df, truth = make_ride(DISTANCES, [30, 25, 35], seed=seed)
    df.to_csv(tmp / "Raw Data.csv", index=False)
    (tmp / "ride.yaml").write_text(
        "date: 2026-10-07\nline: TEST\ndirection: S4\nboard: S0\nalight: S4\nstart_clock: '08:00:00'\n"
    )
    return analyse(tmp, NETWORK), truth


def test_recovers_runs_speeds_and_stations():
    for seed in range(5):  # different phone angles and noise each time
        with tempfile.TemporaryDirectory() as d:
            ride, truth = _ride(Path(d), seed)
            assert not ride.warnings, ride.warnings
            assert len(ride.segments) == len(truth)
            for seg, (dep, arr, dist, peak) in zip(ride.segments, truth):
                assert abs(seg.depart_s - dep) < 2.0, (seed, seg.depart_s, dep)
                assert abs(seg.arrive_s - arr) < 2.0, (seed, seg.arrive_s, arr)
                assert abs(seg.peak_kmh - peak * 3.6) / (peak * 3.6) < 0.10, (seed, seg.peak_kmh, peak * 3.6)
                assert abs(seg.integrated_m - dist) / dist < 0.10, (seed, seg.integrated_m, dist)
            assert [s.from_station for s in ride.segments] == ["S0", "S1", "S2", "S3"]


def test_timetable_deviation():
    with tempfile.TemporaryDirectory() as d:
        ride, truth = _ride(Path(d), 0)
        # recording started 08:00:00 and the first departure is ~20 s in -> 08:00:20
        tt = {"stations": {"S0": {"S4": ["07:55", "08:00", "08:05"]}}}
        rows = compare_timetable(ride, tt)
        assert rows[0]["scheduled"] == "08:00"
        assert 15 <= rows[0]["deviation_s"] <= 25


def test_wrong_station_count_is_flagged_not_mislabelled():
    with tempfile.TemporaryDirectory() as d:
        df, _ = make_ride(DISTANCES, [30, 25, 35])
        df.to_csv(Path(d) / "Raw Data.csv", index=False)
        (Path(d) / "ride.yaml").write_text("date: 2026-10-07\nboard: S0\nalight: S3\nstart_clock: '08:00:00'\n")
        ride = analyse(d, NETWORK)
        assert any("detected 4 runs" in w for w in ride.warnings)
        assert all(s.from_station is None for s in ride.segments)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
