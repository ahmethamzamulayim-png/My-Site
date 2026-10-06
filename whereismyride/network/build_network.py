"""Build network/<line>.json: a line's stations in travel order, with distances.

    python network/build_network.py M4                      # live from Metro İstanbul
    python network/build_network.py M4 --stations seed.json # from a saved GetStations list
    python network/build_network.py M4 --osm                # + along-track distances from OpenStreetMap

Distances matter: every average speed is distance / measured time.

- Default `km` is STRAIGHT-LINE between consecutive stations. On curved track
  that is too short, so speeds come out a few % low. The file says so
  (`km_source`).
- `--osm` replaces it with distance measured along the actual track geometry
  from OpenStreetMap - use this before trusting speed numbers.

Station data: Metro İstanbul GetStations, İBB Açık Veri Portalı (CC BY 4.0).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import requests

API = "https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2"
OVERPASS = "https://overpass-api.de/api/interpreter"


def haversine_km(a: dict, b: dict) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def fetch_stations() -> list[dict]:
    r = requests.get(f"{API}/GetStations", timeout=30)
    r.raise_for_status()
    j = r.json()
    if not j.get("Success", True) or not isinstance(j.get("Data"), list):
        raise RuntimeError(f"unexpected GetStations response: {str(j)[:300]}")
    out = []
    for x in j["Data"]:
        d = x.get("DetailInfo") or {}
        out.append({
            "id": x.get("Id"), "lineId": x.get("LineId"), "line": x.get("LineName"),
            "lat": float(d["Latitude"]) if d.get("Latitude") else None,
            "lng": float(d["Longitude"]) if d.get("Longitude") else None,
            "name": x.get("Description") or x.get("Name"),
        })
    return out


def order_stations(stations: list[dict]) -> list[dict]:
    """Put stations in travel order. The API's list isn't ordered (new stations
    get new ids), so chain nearest neighbours starting from one end of the line:
    the end is the station farthest from the line's centre."""
    cx = sum(s["lat"] for s in stations) / len(stations)
    cy = sum(s["lng"] for s in stations) / len(stations)
    centre = {"lat": cx, "lng": cy}
    left = sorted(stations, key=lambda s: -haversine_km(s, centre))
    chain = [left.pop(0)]
    while left:
        nxt = min(left, key=lambda s: haversine_km(chain[-1], s))
        left.remove(nxt)
        chain.append(nxt)
    # sanity: no hop should be wildly longer than the rest (would mean a branch or a wrong order)
    hops = [haversine_km(a, b) for a, b in zip(chain, chain[1:])]
    if hops and max(hops) > 4 * sorted(hops)[len(hops) // 2]:
        print(f"warning: one hop is {max(hops):.1f} km vs median {sorted(hops)[len(hops) // 2]:.1f} km - "
              "check the order by hand (branch line?)", file=sys.stderr)
    return chain


def osm_track_km(line: str, stations: list[dict]) -> list[float] | None:
    """Cumulative along-track km for each station, from the OSM route relation."""
    q = f"""[out:json][timeout:60];
area["name"="İstanbul"]["admin_level"="4"]->.ist;
relation["route"="subway"]["ref"="{line}"](area.ist);
(._;>;);
out body;"""
    r = requests.post(OVERPASS, data={"data": q}, timeout=120)
    r.raise_for_status()
    els = r.json()["elements"]
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in els if e["type"] == "node"}
    ways = {e["id"]: e["nodes"] for e in els if e["type"] == "way"}
    rels = [e for e in els if e["type"] == "relation"]
    if not rels:
        return None
    rel = rels[0]  # one direction is enough: both run on the same alignment
    track: list[tuple[float, float]] = []
    for m in rel["members"]:
        if m["type"] != "way" or m.get("role") not in ("", None) or m["ref"] not in ways:
            continue  # skip platforms/stops; keep the rails
        pts = [nodes[n] for n in ways[m["ref"]] if n in nodes]
        if track and pts:
            # orient each way so it continues from where the last one ended
            if math.dist(track[-1], pts[-1]) < math.dist(track[-1], pts[0]):
                pts = pts[::-1]
        track.extend(pts)
    if len(track) < 2:
        return None
    cum = [0.0]
    for a, b in zip(track, track[1:]):
        cum.append(cum[-1] + haversine_km({"lat": a[0], "lng": a[1]}, {"lat": b[0], "lng": b[1]}))

    def project(s):  # nearest track vertex -> its along-track distance
        i = min(range(len(track)), key=lambda k: (track[k][0] - s["lat"]) ** 2 + (track[k][1] - s["lng"]) ** 2)
        return cum[i]

    kms = [project(s) for s in stations]
    if kms[-1] < kms[0]:  # relation runs the other way
        kms = [kms[0] - k for k in kms]
    else:
        kms = [k - kms[0] for k in kms]
    if any(b <= a for a, b in zip(kms, kms[1:])):
        print("warning: OSM distances are not increasing along the line - relation pieces may be "
              "out of order; falling back to straight-line", file=sys.stderr)
        return None
    return kms


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("line", help="line code as the API names it, e.g. M4")
    p.add_argument("--stations", help="saved GetStations list (JSON) instead of calling the API")
    p.add_argument("--osm", action="store_true", help="along-track distances from OpenStreetMap")
    p.add_argument("--out", help="default: network/<line>.json")
    args = p.parse_args(argv)

    if args.stations:
        raw = json.loads(Path(args.stations).read_text())
        allst = raw["list"] if isinstance(raw, dict) else raw
    else:
        allst = fetch_stations()
    line = [s for s in allst if s["line"] == args.line and s["lat"] is not None]
    if not line:
        sys.exit(f"no stations for line {args.line}; lines seen: {sorted({s['line'] for s in allst})}")
    ordered = order_stations(line)

    kms, source = None, "straight-line between consecutive stations (PROVISIONAL - too short on curves)"
    if args.osm:
        kms = osm_track_km(args.line, ordered)
        if kms:
            source = "along-track, OpenStreetMap route relation"
    if kms is None:
        kms = [0.0]
        for a, b in zip(ordered, ordered[1:]):
            kms.append(kms[-1] + haversine_km(a, b))

    out = {
        "line": args.line,
        "km_source": source,
        "station_source": "Metro İstanbul GetStations, İBB Açık Veri Portalı (CC BY 4.0)",
        "stations": [
            {"id": s["id"], "name": s["name"], "lat": s["lat"], "lng": s["lng"], "km": round(k, 3)}
            for s, k in zip(ordered, kms)
        ],
    }
    path = Path(args.out or Path(__file__).parent / f"{args.line.lower()}.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"{path}: {len(ordered)} stations, {ordered[0]['name']} -> {ordered[-1]['name']}, "
          f"{kms[-1]:.1f} km ({source.split(' (')[0]})")


if __name__ == "__main__":
    main()
