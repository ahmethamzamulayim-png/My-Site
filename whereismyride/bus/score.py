"""How well does it work? Grades the predictions against what actually happened.

    python -m bus.score              # last 14 days of logs
    python -m bus.score --days 28

Two report cards, both strictly "no peeking": every prediction is made with only the
data that existed at that moment, then checked against what the buses really did.

1. Next bus: at moments through each past morning, predict when each bus reaches my
   stop; error by how far ahead the prediction was - next to the same prediction
   without the live traffic correction (how a kiosk does it).
2. Arrive by: for each past day and target time, the "leave by" it would have given
   (learned from earlier days only) - did I actually arrive on time that often?
   A 90% promise should come true about 90% of the time; much less = overconfident.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from .model import History, find_stop, passages, plan_arrival, predict, reached_times, replay, segment_times, trips_between

BUCKETS = [(0, 5), (5, 10), (10, 20), (20, 60)]


def score_next_bus(stops: pd.DataFrame, pings: pd.DataFrame, line: str, board: str, dest: str,
                   days: list, step_min: int = 10, window=("06:30", "09:30")) -> pd.DataFrame:
    all_pas = passages(pings, stops)  # used ONLY as the truth to grade against
    rows = []
    for day in days:
        before = pings[pings.t.dt.date < day]
        today = pings[pings.t.dt.date == day]
        if before.empty or today.empty:
            continue
        hist_seg = segment_times(passages(before, stops))
        hist = History(hist_seg)
        t = datetime.combine(day, datetime.strptime(window[0], "%H:%M").time())
        end = datetime.combine(day, datetime.strptime(window[1], "%H:%M").time())
        while t <= end:
            known = today[today.t <= t]  # only what existed at that moment
            pas = passages(known, stops)
            seg = pd.concat([hist_seg, segment_times(pas)], ignore_index=True)
            latest = known[known.t > t - timedelta(minutes=2)].sort_values("t").groupby("door").tail(1)
            reached = reached_times(pas)
            live = predict(line, stops, latest, seg, hist, board, dest, 0, t, reached)
            base = {(o["bus"], o["direction"]): o for o in
                    predict(line, stops, latest, seg, hist, board, dest, 0, t, reached, use_live=False)}
            for o in live:
                b_order = int(find_stop(stops, board).query("direction == @o['direction']").order.min())
                truth = all_pas[(all_pas.door == o["bus"]) & (all_pas.order == b_order) & (all_pas.t >= t)]
                if truth.empty:
                    continue
                actual = truth.t.min()
                ahead = (actual - t).total_seconds() / 60
                b = base.get((o["bus"], o["direction"]))
                rows.append({"day": day, "at": t, "minutes_ahead": ahead,
                             "error_min": (o["at_board"] - actual).total_seconds() / 60,
                             "kiosk_error_min": (b["at_board"] - actual).total_seconds() / 60 if b else np.nan,
                             "in_window": o["at_board_early"] <= actual <= o["at_board_late"]})
            t += timedelta(minutes=step_min)
    return pd.DataFrame(rows)


def score_arrive_by(trips: pd.DataFrame, walk_min: float, dest_walk_min: float, days: list,
                    targets=("08:00", "08:30", "09:00", "09:30"), confidence: float = 0.9) -> pd.DataFrame:
    rows = []
    for day in days:
        for tt in targets:
            target = datetime.combine(day, datetime.strptime(tt, "%H:%M").time())
            plan = plan_arrival(trips, target, walk_min, dest_walk_min, confidence)  # learns from days < day only
            if not plan:
                continue
            arrived = replay(trips, day, plan["leave"], walk_min, dest_walk_min)
            if arrived is None:
                continue
            rows.append({"day": day, "target": target, "leave": plan["leave"], "arrived": arrived,
                         "on_time": arrived <= target, "early_min": (target - arrived).total_seconds() / 60})
    return pd.DataFrame(rows)


def report(nb: pd.DataFrame, ab: pd.DataFrame, confidence: float) -> str:
    out = []
    if not nb.empty:
        out += ["NEXT BUS — how far off, by how far ahead it was predicted (minutes)",
                f"{'ahead':>8} {'n':>5} {'typical error':>14} {'within 1 min':>13} {'within 2 min':>13} "
                f"{'in window':>10} {'kiosk-style typical':>20}"]
        for lo, hi in BUCKETS:
            g = nb[(nb.minutes_ahead >= lo) & (nb.minutes_ahead < hi)]
            if g.empty:
                continue
            e, k = g.error_min.abs(), g.kiosk_error_min.abs()
            out.append(f"{f'{lo}-{hi}':>8} {len(g):>5} {e.median():>12.1f} m {(e <= 1).mean():>12.0%} "
                       f"{(e <= 2).mean():>12.0%} {g.in_window.mean():>10.0%} {k.median():>18.1f} m")
        late = (nb.error_min < 0).mean()
        out.append(f"bus came later than predicted {late:.0%} of the time (50% = unbiased); "
                   "'in window' should be ~80% (10th–90th percentile)")
    if not ab.empty:
        out += ["", f"ARRIVE BY — promised {confidence:.0%} on time",
                f"actually on time: {ab.on_time.mean():.0%} of {len(ab)} planned trips · "
                f"usually {ab.early_min.median():.0f} min early · "
                f"latest: {(-ab.early_min).max():.0f} min late" if (~ab.on_time).any() else
                f"actually on time: {ab.on_time.mean():.0%} of {len(ab)} planned trips · usually {ab.early_min.median():.0f} min early"]
        gap = ab.on_time.mean() - confidence
        out.append("→ about right" if abs(gap) <= 0.1 else ("→ too cautious (leaves earlier than needed)" if gap > 0
                                                              else "→ OVERCONFIDENT: arrives late more often than promised"))
    return "\n".join(out) if out else "nothing to score yet - needs a few days of logs"


def main(argv=None):
    from .leave import load
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--config", default=Path(__file__).with_name("routes.yaml"))
    p.add_argument("--days", type=int, default=14, help="how many recent days to grade")
    p.add_argument("--confidence", type=float, default=0.9)
    p.add_argument("--at", help="grade as if it were this local time (default now)")
    args = p.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text())
    data = Path(cfg.get("data_dir", "data/bus"))
    now = datetime.fromisoformat(args.at) if args.at else datetime.now()
    nb_all, trips = [], []
    for line in cfg["lines"]:
        stops, pings = load(data, line, 60, now)
        if pings.empty:
            continue
        days = sorted(pings.t.dt.date.unique())[-args.days:]
        for board in cfg["board"]:
            nb_all.append(score_next_bus(stops, pings, line, board, cfg["destination"], days).assign(line=line, board=board))
        trips.append((stops, passages(pings, stops)))
    nb = pd.concat(nb_all, ignore_index=True) if nb_all else pd.DataFrame()
    ab_all = []
    for board, b in cfg["board"].items():
        tr = pd.concat([trips_between(pas, st, board, cfg["destination"]) for st, pas in trips], ignore_index=True) if trips else pd.DataFrame()
        if not tr.empty:
            days = sorted(tr.day.unique())[-args.days:]
            ab_all.append(score_arrive_by(tr, b["walk_min"], cfg.get("dest_walk_min", 0), days,
                                          confidence=args.confidence).assign(board=board))
    ab = pd.concat(ab_all, ignore_index=True) if ab_all else pd.DataFrame()
    print(report(nb, ab, args.confidence))


if __name__ == "__main__":
    main()
