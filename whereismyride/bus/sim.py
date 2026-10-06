"""Simulated bus line for tests: known stop times, known traffic, pings like İETT's.

Not a model of the real line 2 - round numbers, so the tests can check the
predictor against a truth it couldn't see.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pandas as pd

NAMES = ["HAREM", "A", "B", "KAZASKER", "C", "AYŞEKADIN", "D", "E", "F", "G", "MARMARA ÜNİVERSİTESİ", "H", "BOSTANCI"]


def stops(line: str = "2") -> pd.DataFrame:
    rows = [{"line": line, "direction": "G", "order": i + 1, "stop": str(100 + i), "name": n} for i, n in enumerate(NAMES)]
    rows += [{"line": line, "direction": "D", "order": i + 1, "stop": str(200 + i), "name": n}
             for i, n in enumerate(reversed(NAMES))]
    return pd.DataFrame(rows)


def simulate(start: datetime, days: int, jam: tuple[datetime, datetime, float] | None = None,
             headway_min: int = 8, seg_s: float = 90.0, poll_s: int = 30, seed: int = 0, line: str = "2"):
    """Buses on direction G from 06:00 to 10:00 each day.
    Returns (pings DataFrame like the collector's log, truth DataFrame of real stop times).
    jam = (from, until, factor): segments are `factor` times slower while a bus drives them in that window."""
    rng = np.random.default_rng(seed)
    n = len(NAMES)
    pings, truth = [], []
    bus_id = 0
    for d in range(days):
        day = start + timedelta(days=d)
        t0 = day.replace(hour=6, minute=0, second=0)
        while t0 < day.replace(hour=10):
            bus_id += 1
            door = f"K-{bus_id % 40:03d}"
            t, times = t0, [t0]
            for k in range(1, n):
                s = seg_s * rng.lognormal(0, 0.15)
                if jam and jam[0] <= t < jam[1]:
                    s *= jam[2]
                t = t + timedelta(seconds=s)
                times.append(t)
            for k, tk in enumerate(times):
                truth.append({"door": door, "order": k + 1, "t": tk, "trip_start": t0})
            # polls: the service reports the last stop passed as the nearest stop
            phase = rng.integers(0, poll_s)
            p = t0 + timedelta(seconds=int(phase))
            while p <= times[-1]:
                k = max(i for i, tk in enumerate(times) if tk <= p)
                pings.append({"poll_time": p.isoformat(), "door": door, "line": line, "route": f"{line}_G_D0",
                              "near_stop": str(100 + k), "t": p})
                p += timedelta(seconds=poll_s)
            t0 += timedelta(minutes=headway_min)
    return pd.DataFrame(pings), pd.DataFrame(truth)
