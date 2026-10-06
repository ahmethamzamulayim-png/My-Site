"""When should I leave? Every bus on my lines that can get me to my destination, best first.

    python -m bus.leave                  # uses bus/routes.yaml and the collected logs
    python -m bus.leave --at "2026-10-08 08:00"   # replay a moment from the logs (for checking)
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yaml

from .model import History, passages, predict, reached_times, segment_times

IST = ZoneInfo("Europe/Istanbul")


def load(data: Path, line: str, days: int, until: datetime):
    stops = pd.DataFrame(json.loads((data / "stops" / f"{line}.json").read_text()))
    files = [data / "positions" / f"{(until - timedelta(days=d)):%Y-%m-%d}.csv" for d in range(days)]
    pings = pd.concat([pd.read_csv(f, dtype={"near_stop": str, "door": str, "line": str}) for f in files if f.exists()],
                      ignore_index=True)
    pings = pings[pings.line.astype(str) == line]
    pings = pings.assign(t=pd.to_datetime(pings.poll_time).dt.tz_localize(None))
    return stops, pings[pings.t <= until.replace(tzinfo=None)]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--config", default=Path(__file__).with_name("routes.yaml"))
    p.add_argument("--at", help="pretend it's this local time (replay), default now")
    p.add_argument("--days", type=int, default=28, help="history to learn from")
    args = p.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text())
    data = Path(cfg.get("data_dir", "data/bus"))
    now = datetime.fromisoformat(args.at) if args.at else datetime.now(IST).replace(tzinfo=None)

    options = []
    for line in cfg["lines"]:
        stops, pings = load(data, line, args.days, now)
        if pings.empty:
            print(f"{line}: no position logs yet - run bus.collect first")
            continue
        pas = passages(pings, stops)
        seg = segment_times(pas)
        hist = History(seg)
        reached = reached_times(pas)
        latest = pings[pings.t > now - timedelta(minutes=2)].sort_values("t").groupby("door").tail(1)
        for board, b in cfg["board"].items():
            options += predict(line, stops, latest, seg, hist, board, cfg["destination"], b["walk_min"], now, reached)

    if not options:
        print("no bus can be predicted right now (no buses on the way, or not enough history yet)")
        return
    print(f"{now:%H:%M}  →  {cfg['destination']}\n")
    print(f"{'line':>4}  {'from':<12} {'leave by':>8}  {'bus at stop':>17}  {'arrive':>6}  traffic")
    for o in sorted(options, key=lambda o: o["at_dest"])[:8]:
        late = "" if o["leave_by"] >= now else "  (too late to walk)"
        tf = f"×{o['traffic_factor']}" + ("" if o["live_segments"] else " (no live data)")
        print(f"{o['line']:>4}  {o['board']:<12} {o['leave_by']:%H:%M}  "
              f"{o['at_board_early']:%H:%M}–{o['at_board_late']:%H:%M} ({o['at_board']:%H:%M})  {o['at_dest']:%H:%M}  {tf}{late}")
    print("\nleave by = catch it 9 times in 10 (planned on the bus's early arrival); traffic ×2 = stretch running at half usual speed")


if __name__ == "__main__":
    main()
