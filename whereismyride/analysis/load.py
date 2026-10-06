"""Load a phyphox export into one time-indexed DataFrame.

phyphox exports each sensor as its own CSV ("Linear Acceleration.csv",
"Magnetometer.csv", "Pressure.csv", or a single "Raw Data.csv" for the
one-sensor experiments), either loose in a folder or inside a .zip. Column
names look like "Time (s)", "Linear Acceleration x (m/s^2)", ...

Everything is resampled onto one uniform clock so the detectors can work
with fixed-length windows. Output columns (whichever sensors were recorded):
    ax, ay, az   linear acceleration, gravity removed, m/s^2
    mag          magnetic field magnitude, uT
    pressure     hPa
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

RATE_HZ = 50  # resample target; phone accelerometers run 100-500 Hz, 50 is plenty for a train


def _read_csvs(path: Path) -> dict[str, pd.DataFrame]:
    """Return {file stem: DataFrame} for every CSV in a folder or zip."""
    out = {}
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.lower().endswith(".csv") and "meta" not in name.lower():
                    out[Path(name).stem] = pd.read_csv(io.BytesIO(z.read(name)))
    elif path.is_dir():
        for f in sorted(path.glob("*.csv")):
            out[f.stem] = pd.read_csv(f)
    else:
        out[path.stem] = pd.read_csv(path)
    return out


def _col(df: pd.DataFrame, *patterns: str) -> str | None:
    """First column whose name matches all regex patterns (case-insensitive)."""
    for c in df.columns:
        if all(re.search(p, c, re.I) for p in patterns):
            return c
    return None


def load_phyphox(path: str | Path, rate_hz: int = RATE_HZ) -> pd.DataFrame:
    path = Path(path)
    frames = _read_csvs(path)
    if not frames:
        raise FileNotFoundError(f"no CSV files found in {path}")

    series: dict[str, pd.Series] = {}
    for stem, df in frames.items():
        t = _col(df, r"^time")
        if t is None:
            continue
        time = df[t].to_numpy(dtype=float)
        is_mag = re.search(r"magnet", stem, re.I) or _col(df, r"magnetic")
        for axis in "xyz":
            c = _col(df, rf"\b{axis}\b", r"acceler")
            if c and not is_mag:
                series[f"a{axis}"] = pd.Series(df[c].to_numpy(float), index=time)
        if is_mag:
            cols = [_col(df, rf"\b{a}\b") for a in "xyz"]
            if all(cols):
                m = np.sqrt(sum(df[c].to_numpy(float) ** 2 for c in cols))
                series["mag"] = pd.Series(m, index=time)
        p = _col(df, r"pressure")
        if p:
            series["pressure"] = pd.Series(df[p].to_numpy(float), index=time)

    if not {"ax", "ay", "az"} <= series.keys():
        raise ValueError(
            "no linear-acceleration x/y/z columns found - record with phyphox's "
            "'Acceleration (without g)' sensor. Columns seen: "
            + "; ".join(f"{k}: {list(v.columns)}" for k, v in frames.items())
        )

    t0 = min(s.index.min() for s in series.values())
    t1 = max(s.index.max() for s in series.values())
    grid = np.arange(t0, t1, 1.0 / rate_hz)
    out = pd.DataFrame(index=pd.Index(grid, name="t"))
    for name, s in series.items():
        s = s[~s.index.duplicated()].sort_index()
        out[name] = np.interp(grid, s.index.to_numpy(), s.to_numpy(), left=np.nan, right=np.nan)
    return out
