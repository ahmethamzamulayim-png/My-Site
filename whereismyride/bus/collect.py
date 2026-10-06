"""Poll İETT for my lines' bus positions all day; append to data/bus/positions/<date>.csv.

    python -m bus.collect                 # run forever (home machine / Pi / small server)
    python -m bus.collect --stops-only    # just fetch and print each line's stop list

Run it somewhere always-on: GitHub Actions can't poll every 30 s, and Deno cron's
1-minute minimum is borderline. A systemd service on a Pi at home is ideal:

    [Service]
    WorkingDirectory=/home/pi/WhereisMyRide
    ExecStart=/usr/bin/python3 -m bus.collect
    Restart=always

The service is slow and reportedly shuts down nightly after 00:15 - errors are
logged and retried with back-off, never fatal.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from . import iett

IST = ZoneInfo("Europe/Istanbul")
FIELDS = ["poll_time", "door", "line", "route", "heading_to", "lat", "lon", "fix_time", "near_stop"]


def refresh_stops(lines: list[str], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for line in lines:
        try:
            stops = iett.line_stops(line)
        except Exception as e:  # keep yesterday's copy if today's fetch fails
            print(f"stops {line}: {e}")
            continue
        if stops:
            (out / f"{line}.json").write_text(json.dumps(stops, ensure_ascii=False, indent=1))
            print(f"stops {line}: {len(stops)} rows, directions {sorted({s['direction'] for s in stops})}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--config", default=Path(__file__).with_name("routes.yaml"))
    p.add_argument("--stops-only", action="store_true")
    args = p.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text())
    data = Path(cfg.get("data_dir", "data/bus"))

    refresh_stops(cfg["lines"], data / "stops")
    if args.stops_only:
        for line in cfg["lines"]:
            f = data / "stops" / f"{line}.json"
            if f.exists():
                for s in json.loads(f.read_text()):
                    print(f"{line:>4} {s['direction']:>2} {s['order']:>3}  {s['stop']:>7}  {s['name']}")
        return

    backoff, stops_day = cfg.get("poll_seconds", 30), datetime.now(IST).date()
    while True:
        now = datetime.now(IST)
        if now.date() != stops_day:  # stop lists change rarely; refresh daily
            refresh_stops(cfg["lines"], data / "stops")
            stops_day = now.date()
        rows, failed = [], False
        for line in cfg["lines"]:
            try:
                for b in iett.line_buses(line):
                    rows.append({"poll_time": now.isoformat(timespec="seconds"), **{k: b[k] for k in FIELDS if k in b}})
            except Exception as e:
                print(f"{now:%H:%M:%S} {line}: {e}")
                failed = True
        if rows:
            f = data / "positions" / f"{now:%Y-%m-%d}.csv"
            f.parent.mkdir(parents=True, exist_ok=True)
            new = not f.exists()
            with f.open("a", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=FIELDS)
                if new:
                    w.writeheader()
                w.writerows(rows)
        # back off up to 10 min while the service is down (e.g. its nightly shutdown), else poll normally
        backoff = min(backoff * 2, 600) if failed and not rows else cfg.get("poll_seconds", 30)
        time.sleep(backoff)


if __name__ == "__main__":
    main()
