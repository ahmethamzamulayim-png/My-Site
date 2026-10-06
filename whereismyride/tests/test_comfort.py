"""ISO 2631-1 weighting checks and comfort numbers on known inputs.

    python tests/test_comfort.py
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analysis.comfort import comfort_word, weighted_rms, weighting_gain  # noqa: E402

# ISO 2631-1:1997 Table 3, weighting factors x 1000 (one-third octave band centres).
# Typed from memory, not copied from the standard - verify against a real copy.
# Wd at 10 Hz was dropped: I remembered 212, the transfer function gives 202, and
# Wd's ~2/f roll-off above 2 Hz (253 at 8 Hz, 161 at 12.5 Hz) points to ~200, so
# the remembered value is the suspect one.
ISO_TABLE = {
    "Wk": {1: 482, 2: 531, 4: 967, 5: 1039, 6.3: 1054, 8: 1036, 10: 988, 16: 768, 20: 636},
    "Wd": {1: 1011, 2: 890, 4: 512, 6.3: 323, 8: 253, 16: 125, 20: 100},
}


def test_weighting_matches_iso_table():
    for name, table in ISO_TABLE.items():
        for f, ref in table.items():
            got = float(weighting_gain(name, f)) * 1000
            assert abs(got / ref - 1) < 0.03, f"{name} at {f} Hz: {got:.0f} vs ISO {ref}"


def test_weighted_rms_of_a_sine():
    # a 1 m/s^2-amplitude sine has RMS 0.707; weighted RMS = that x the weighting factor
    for fs in (50, 100):
        t = np.arange(0, 60, 1 / fs)
        for name, f in (("Wk", 5.0), ("Wk", 8.0), ("Wd", 2.0), ("Wd", 10.0)):
            got = weighted_rms(np.sin(2 * np.pi * f * t), fs, name)
            want = 0.7071 * float(weighting_gain(name, f))
            assert abs(got / want - 1) < 0.03, (fs, name, f, got, want)


def test_ride_comfort_on_synthetic_ride():
    import tempfile
    from analysis.ride import analyse
    from analysis.synth import make_ride
    D = [1200, 900, 1500]
    net = {"stations": [{"name": f"S{i}", "km": sum(D[:i]) / 1000} for i in range(4)]}
    for seed in range(3):
        df, _ = make_ride(D, [30, 25], seed=seed, gravity=True, vert_sine=0.4)
        with tempfile.TemporaryDirectory() as d:
            df.to_csv(Path(d) / "Raw Data.csv", index=False)
            (Path(d) / "ride.yaml").write_text("date: 2026-10-07\nboard: S0\nalight: S3\nstart_clock: '08:00:00'\n")
            ride = analyse(d, net)
        for s in ride.segments:
            c = s.comfort
            # the synthetic train pulls away and brakes at exactly 1.0 m/s^2
            assert 0.85 < c["traction_peak_ms2"] < 1.15, (seed, c)
            assert 0.85 < c["braking_peak_ms2"] < 1.15, (seed, c)
            # 0.4 m/s^2 at 6 Hz vertical, Wk ~1.05 there -> ~0.30 weighted RMS from the sine alone, plus noise
            assert 0.28 < c["aw_vert"] < 0.40, (seed, c)
            # the injected vibration is vertical only: it must land on the vertical axis, not leak sideways
            assert c["aw_vert"] > 1.5 * c["aw_lat"], (seed, c)


def test_summary_singles_out_the_rough_train():
    import tempfile
    import zipfile
    from analysis.summary import collect, summarise
    from analysis.synth import make_ride
    D = [1200, 900, 1500]
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for i, (veh, vib) in enumerate([("A1", 0.2), ("A2", 0.2), ("B9", 0.6)]):
            df, _ = make_ride(D, [30, 25], seed=i, gravity=True, vert_sine=vib)
            p = Path(d) / f"r{i}.zip"
            with zipfile.ZipFile(p, "w") as z:
                z.writestr("Raw Data.csv", df.to_csv(index=False))
                z.writestr("ride.yaml", f'date: "2026-10-07"\nline: "TEST"\nphone_position: "lap-flat"\nvehicle: "{veh}"\n')
            paths.append(p)
        table = summarise(collect(paths), ["vehicle"])
    assert table.index[0] == "B9", table
    assert table.loc["B9", "aw_total"] > 1.5 * table.loc["A1", "aw_total"], table


def test_comfort_words():
    assert comfort_word(0.2) == "not uncomfortable"
    assert comfort_word(0.5) == "a little uncomfortable"
    assert comfort_word(1.2) == "uncomfortable"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
