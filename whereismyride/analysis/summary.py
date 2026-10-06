"""Compare many rides: per line, per train (car number), per stretch of track.

    python -m analysis.summary rides/            # every ride folder or app .zip under it
    python -m analysis.summary rides/ --csv out.csv

One row per run between two stations goes into the table; the summaries are
medians, because one bumped phone or one held train shouldn't move a result.

What each view answers:
- by line:     which line gives the smoothest ride, which brakes hardest
- by vehicle:  do some trains (car numbers -> fleets) ride worse than others on
               the SAME track? Only meaningful within one line.
- by stretch:  which piece of track is rough every time, whichever train runs it
               - and, over weeks, whether it's getting worse (maintenance signal)

Only rides with the same phone_position are comparable for vibration; the
tables are split by it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from .ride import analyse


def find_rides(root: Path) -> list[Path]:
    rides = [p for p in root.rglob("*.zip")]
    rides += [p.parent for p in root.rglob("ride.yaml") if p.parent.name != "_example" and any(p.parent.glob("*.csv"))]
    return sorted(set(rides))


def load_network(line: str) -> dict | None:
    here = Path(__file__).resolve().parents[1] / "network"
    if (here / f"{line.lower()}.json").exists():
        return json.loads((here / f"{line.lower()}.json").read_text())
    if (here / "lines.json").exists():
        return next((l for l in json.loads((here / "lines.json").read_text())["lines"] if l["line"] == line), None)
    return None


def collect(paths: list[Path]) -> pd.DataFrame:
    rows = []
    for p in paths:
        try:
            from .ride import _read_meta
            meta = _read_meta(p)
            ride = analyse(p, load_network(meta.get("line", "M4")))
        except Exception as e:  # one broken file shouldn't stop the summary
            print(f"skip {p.name}: {e}")
            continue
        for k, s in enumerate(ride.segments):
            dwell = s.depart_s - ride.segments[k - 1].arrive_s if k else None
            rows.append({
                "ride": p.name, "date": str(meta.get("date")), "line": meta.get("line"),
                "vehicle": str(meta.get("vehicle") or ""), "phone_position": meta.get("phone_position"),
                "stretch": f"{s.from_station} → {s.to_station}" if s.from_station else None,
                "run_s": round(s.run_s, 1), "dwell_s": round(dwell, 1) if dwell is not None else None,
                "avg_kmh": s.avg_kmh, "peak_kmh": s.peak_kmh, **{k2: v for k2, v in s.comfort.items() if k2 != "comfort"},
            })
    return pd.DataFrame(rows)


METRICS = ["aw_total", "traction_peak_ms2", "braking_peak_ms2", "jerk_start_ms3", "jerk_stop_ms3", "peak_kmh"]


def summarise(df: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    cols = [m for m in METRICS if m in df.columns]
    g = df.dropna(subset=[b for b in by]).groupby(by)
    out = g[cols].median().round(3)
    out.insert(0, "runs", g.size())
    out.insert(1, "rides", g["ride"].nunique())
    return out.sort_values("aw_total" if "aw_total" in cols else cols[0], ascending=False)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("root", help="folder holding ride folders and/or app .zip files")
    p.add_argument("--csv", help="also write every run as one CSV row here")
    args = p.parse_args(argv)

    df = collect(find_rides(Path(args.root)))
    if df.empty:
        print("no rides found")
        return
    if args.csv:
        df.to_csv(args.csv, index=False)
    pd.set_option("display.width", 160)
    print(f"{df['ride'].nunique()} rides, {len(df)} runs between stations\n")
    for pos, part in df.groupby("phone_position", dropna=False):
        print(f"=== phone position: {pos} ===")
        print("\nby line\n", summarise(part, ["line"]).to_string())
        if part["vehicle"].str.len().gt(0).any():
            print("\nby vehicle (within a line)\n", summarise(part[part["vehicle"] != ""], ["line", "vehicle"]).to_string())
        print("\nby stretch of track (roughest first)\n", summarise(part, ["line", "stretch"]).head(15).to_string())
        print()
    print("medians; aw_total = ISO 2631-1 weighted vibration m/s^2 (phone, not seat sensor - compare, don't quote);\n"
          "traction/braking m/s^2; jerk m/s^3 (1 Hz smoothed - comparable between rides, not an absolute limit test)")


if __name__ == "__main__":
    main()
