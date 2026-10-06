"""Save today's official timetable for one line: every station, every direction.

    python timetable/fetch_timetable.py M4

Writes timetable/<YYYY-MM-DD>.json (normalised, what analysis/ride.py reads)
and timetable/raw/<YYYY-MM-DD>.json (the API's responses as received, so a
parsing mistake here can be fixed later without losing the day).

The API returns *today's* times only (minute precision, HH:MM), so run this
every day - including weekends, which may have their own timetable.

Request shapes follow mdemirer/sonraki-tren, a working client of this API:
    POST GetDirectionsByLineIdAndStationId  {lineId, stationId}
    POST GetTimeTable                        {boardingStationId, directionId}
The gateway answers 503 when hit too fast, so requests are spaced out.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API = "https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2"
GAP_S = 0.5
HERE = Path(__file__).parent


def call(method: str, path: str, body: dict | None = None):
    for attempt in range(4):
        r = requests.request(method, API + path, json=body, timeout=30)
        if r.status_code in (429, 503) and attempt < 3:
            time.sleep(2 * (attempt + 1))
            continue
        r.raise_for_status()
        j = r.json()
        if isinstance(j, dict) and j.get("Success") is False:
            raise RuntimeError(f"{path}: API error {j.get('Error') or j.get('Message')}")
        return j.get("Data", j) if isinstance(j, dict) else j
    raise RuntimeError(f"{path}: still rate-limited after retries")


def extract_times(data) -> list[str]:
    """Data[0].TimeInfos[0].Times, with a fallback search for any list of HH:MM strings."""
    row = data[0] if isinstance(data, list) and data else data
    ti = row.get("TimeInfos") if isinstance(row, dict) else None
    ti = ti[0] if isinstance(ti, list) and ti else ti
    times = ti.get("Times") if isinstance(ti, dict) else None
    if not times:
        def walk(o):
            if isinstance(o, list) and o and all(isinstance(x, str) and re.match(r"^\d{1,2}:\d{2}", x) for x in o):
                return o
            for v in (o.values() if isinstance(o, dict) else o if isinstance(o, list) else []):
                found = walk(v)
                if found:
                    return found
            return None
        times = walk(data) or []
    return sorted({t[:5].zfill(5) for t in times})


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("line", help="e.g. M4")
    p.add_argument("--network", help="default: network/<line>.json (gives the station ids and order)")
    args = p.parse_args(argv)

    net = json.loads(Path(args.network or HERE.parent / "network" / f"{args.line.lower()}.json").read_text())
    today = datetime.now(ZoneInfo("Europe/Istanbul")).date().isoformat()
    line_id = None
    stations_out, raw = {}, {"line": args.line, "date": today, "responses": []}

    for s in net["stations"]:
        if line_id is None:  # the network file has station ids; the API wants the line id too
            allst = call("GET", "/GetStations")
            line_id = next(x["LineId"] for x in allst if x["Id"] == s["id"])
        dirs = call("POST", "/GetDirectionsByLineIdAndStationId", {"lineId": line_id, "stationId": s["id"]})
        raw["responses"].append({"station": s["name"], "directions": dirs})
        time.sleep(GAP_S)
        for d in dirs or []:
            did, dname = d.get("DirectionId"), d.get("DirectionName")
            if did is None:
                continue
            try:
                tt = call("POST", "/GetTimeTable", {"boardingStationId": s["id"], "directionId": did})
            except Exception as e:  # e.g. a terminus has no departures towards itself
                print(f"  {s['name']} -> {dname}: {e}", file=sys.stderr)
                continue
            raw["responses"].append({"station": s["name"], "direction": dname, "timetable": tt})
            times = extract_times(tt)
            if times:
                stations_out.setdefault(s["name"], {})[dname] = times
            time.sleep(GAP_S)
        n = sum(len(v) for v in stations_out.get(s["name"], {}).values())
        print(f"{s['name']:<28} {len(dirs or [])} directions, {n} departures")

    (HERE / "raw").mkdir(exist_ok=True)
    (HERE / "raw" / f"{today}.json").write_text(json.dumps(raw, ensure_ascii=False))
    out = {"line": args.line, "date": today, "fetched_at": datetime.now(ZoneInfo("Europe/Istanbul")).isoformat(timespec="seconds"),
           "source": "Metro İstanbul GetTimeTable, İBB Açık Veri Portalı", "stations": stations_out}
    (HERE / f"{today}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    directions = sorted({d for v in stations_out.values() for d in v})
    print(f"\nwrote timetable/{today}.json - direction names (use one in ride.yaml): {directions}")


if __name__ == "__main__":
    main()
