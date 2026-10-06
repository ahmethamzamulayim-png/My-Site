"""When should I leave - to be at my destination by a given time? And when's the next bus?

    python -m bus.leave --arrive-by 09:00             # THE question: leave home by when?
    python -m bus.leave --arrive-by 09:00 --date 2026-10-09 --confidence 0.95
    python -m bus.leave                               # curiosity: the next buses at my stops, live
    python -m bus.leave --at "2026-10-08 08:00"       # replay any moment from the logs

Settings (lines, stops, walking times) come from bus/routes.yaml; data from bus.collect's logs.
How well it works: python -m bus.score
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yaml

from .model import History, passages, plan_arrival, predict, reached_times, segment_times, trips_between

IST = ZoneInfo("Europe/Istanbul")


def load(data: Path, line: str, days: int, until: datetime):
    stops = pd.DataFrame(json.loads((data / "stops" / f"{line}.json").read_text()))
    files = [data / "positions" / f"{(until - timedelta(days=d)):%Y-%m-%d}.csv" for d in range(days + 1)]
    frames = [pd.read_csv(f, dtype={"near_stop": str, "door": str, "line": str}) for f in files if f.exists()]
    if not frames:
        return stops, pd.DataFrame(columns=["door", "route", "near_stop", "t", "line"])
    pings = pd.concat(frames, ignore_index=True)
    pings = pings[pings.line.astype(str) == line]
    pings = pings.assign(t=pd.to_datetime(pings.poll_time).dt.tz_localize(None))
    return stops, pings[pings.t <= until.replace(tzinfo=None)]


def build(cfg: dict, data: Path, days: int, until: datetime) -> dict:
    """Per line: stops, pings, passages, segment times, history."""
    out = {}
    for line in cfg["lines"]:
        stops, pings = load(data, line, days, until)
        if pings.empty:
            continue
        pas = passages(pings, stops)
        seg = segment_times(pas)
        out[line] = {"stops": stops, "pings": pings, "pas": pas, "seg": seg, "hist": History(seg)}
    return out


def arrive_by(cfg: dict, lines: dict, target: datetime, confidence: float) -> list[dict]:
    """Per boarding stop: latest time to leave home. At a stop I take whichever of my lines comes
    first, so the trips of all lines serving that stop are pooled."""
    dest_walk = cfg.get("dest_walk_min", 0)
    plans = []
    for board, b in cfg["board"].items():
        trips = pd.concat([trips_between(L["pas"], L["stops"], board, cfg["destination"]) for L in lines.values()],
                          ignore_index=True)
        plan = plan_arrival(trips, target, b["walk_min"], dest_walk, confidence)
        if plan:
            plans.append({"board": board, **plan})
    return sorted(plans, key=lambda p: p["leave"], reverse=True)


def next_buses(cfg: dict, lines: dict, now: datetime) -> list[dict]:
    options = []
    for line, L in lines.items():
        latest = L["pings"][L["pings"].t > now - timedelta(minutes=2)].sort_values("t").groupby("door").tail(1)
        reached = reached_times(L["pas"])
        for board, b in cfg["board"].items():
            options += predict(line, L["stops"], latest, L["seg"], L["hist"], board, cfg["destination"],
                               b["walk_min"], now, reached)
    return sorted(options, key=lambda o: o["at_board"])


def _early(m: float) -> str:
    return f"{m:.0f} min early" if m >= 0 else f"{-m:.0f} min LATE"


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--config", default=Path(__file__).with_name("routes.yaml"))
    p.add_argument("--arrive-by", help="HH:MM - be at the destination by then")
    p.add_argument("--date", help="YYYY-MM-DD for --arrive-by (default today)")
    p.add_argument("--confidence", type=float, default=0.9, help="share of days to arrive on time (default 0.9)")
    p.add_argument("--at", help="pretend it's this local time (replay), default now")
    p.add_argument("--days", type=int, default=28, help="history to learn from")
    args = p.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text())
    data = Path(cfg.get("data_dir", "data/bus"))
    now = datetime.fromisoformat(args.at) if args.at else datetime.now(IST).replace(tzinfo=None)
    lines = build(cfg, data, args.days, now)
    if not lines:
        print("no position logs yet - run `python -m bus.collect` first")
        return

    if args.arrive_by:
        day = datetime.fromisoformat(args.date).date() if args.date else now.date()
        target = datetime.combine(day, datetime.strptime(args.arrive_by, "%H:%M").time())
        plans = arrive_by(cfg, lines, target, args.confidence)
        print(f"To be at {cfg['destination']} by {target:%H:%M} on {target:%a %d %b} "
              f"({args.confidence:.0%} of days):\n")
        if not plans:
            print("not enough history yet (needs ~5 past days of the same kind - weekday/weekend)")
            return
        for i, pl in enumerate(plans):
            star = "→" if i == 0 else " "
            print(f"{star} leave by {pl['leave']:%H:%M}, walk to {pl['board']:<12} "
                  f"on time {pl['on_time_rate']:.0%} of {pl['days']} past days · "
                  f"usually {pl['typical_early_min']:.0f} min early, worst day {_early(pl['worst_early_min'])}")
        print("\nBased on replaying past days: 'had I left then, which bus would I have caught?'")
        if 0 <= (target - now).total_seconds() <= 90 * 60:  # target soon: check today's buses too
            live = [o for o in next_buses(cfg, lines, now)
                    if o["at_dest"] + timedelta(minutes=cfg.get("dest_walk_min", 0)) <= target and o["leave_by"] >= now]
            if live:
                o = max(live, key=lambda o: o["leave_by"])
                print(f"Right now: bus {o['line']} reaches {o['board']} ~{o['at_board']:%H:%M}, arrives "
                      f"~{o['at_dest']:%H:%M} - leave by {o['leave_by']:%H:%M}")
        return

    options = next_buses(cfg, lines, now)
    if not options:
        print("no bus on the way that can be predicted right now (or not enough history yet)")
        return
    print(f"{now:%H:%M}  next buses  →  {cfg['destination']}\n")
    print(f"{'line':>4}  {'at stop':<12} {'in':>6}  {'window':>11}  {'arrive':>6}  {'leave by':>8}  traffic")
    for o in options[:10]:
        mins = (o["at_board"] - now).total_seconds() / 60
        late = "" if o["leave_by"] >= now else " (too late)"
        tf = f"×{o['traffic_factor']}" + ("" if o["live_segments"] else " (no live data)")
        print(f"{o['line']:>4}  {o['board']:<12} {mins:>4.0f} m  {o['at_board_early']:%H:%M}–{o['at_board_late']:%H:%M}  "
              f"{o['at_dest']:%H:%M}  {o['leave_by']:%H:%M}{late:<11}  {tf}")
    print("\nwindow = early–late (10th–90th percentile); traffic ×2 = road running at half usual speed")


if __name__ == "__main__":
    main()
