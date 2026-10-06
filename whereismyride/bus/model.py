"""From logged bus positions to "leave at 08:07".

1. passages():   position pings -> when each bus reached each stop
2. History:      stop-to-stop travel times, by weekday/weekend and hour
3. live_factor(): how slow the road is RIGHT NOW, from the buses that just
                  drove it, relative to its usual speed (the traffic correction)
4. predict():    for each bus heading to my stop: when it reaches my stop and
                  my destination - and the latest moment to leave home

Why a range and an EARLY quantile for leaving: to catch a bus nine times in
ten, you must be at the stop before it in nine cases out of ten - so plan
against its 10th-percentile (early) arrival, not its median. Planning on the
median means missing it half the time it runs early.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

MAX_GAP_S = 15 * 60  # a bus silent this long has started a new trip (or gone to the garage)
LIVE_WINDOW_MIN = 30  # how far back "right now" reaches for the traffic correction
MIN_LIVE_SEGMENTS = 2


def norm(s: str) -> str:
    """Case- and accent-insensitive stop-name key: 'Ayşekadın' == 'AYSEKADIN'."""
    s = s.replace("ı", "i").replace("İ", "I")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    return " ".join(s.replace(".", " ").split())


def direction_of(route_code: str) -> str:
    """'15B_G_D0' -> 'G'. İETT route codes carry the direction letter in the middle."""
    parts = (route_code or "").split("_")
    return parts[1] if len(parts) >= 3 else ""


def passages(pings: pd.DataFrame, stops: pd.DataFrame) -> pd.DataFrame:
    """When each bus reached each stop.

    pings: door, route, near_stop, t (datetime) - one row per poll per bus.
    stops: direction, order, stop, name.
    The service reports each bus's nearest stop; when that moves forward along
    the route, the bus has passed the stops in between. Skipped stops (bus
    passed two between polls) get times interpolated between the two pings.
    Precision is about the polling interval (~30 s).
    """
    order_of = {(r.direction, r.stop): r.order for r in stops.itertuples()}
    out = []
    pings = pings.assign(direction=pings.route.map(direction_of)).sort_values(["door", "t"])
    for (door, route), g in pings.groupby(["door", "route"]):
        trip, last_order, last_t = 0, None, None
        for r in g.itertuples():
            k = order_of.get((r.direction, str(r.near_stop)))
            if k is None:
                continue
            if last_t is not None and ((r.t - last_t).total_seconds() > MAX_GAP_S or k < last_order):
                trip, last_order = trip + 1, None  # new trip
            if last_order is None:
                out.append((door, route, r.direction, trip, k, r.t))
            elif k > last_order:
                span = (r.t - last_t).total_seconds()
                for step, kk in enumerate(range(last_order + 1, k + 1), start=1):
                    when = last_t + timedelta(seconds=span * step / (k - last_order))
                    out.append((door, route, r.direction, trip, kk, when))
            if last_order is None or k >= last_order:
                last_order, last_t = k, r.t
    return pd.DataFrame(out, columns=["door", "route", "direction", "trip", "order", "t"])


def segment_times(pas: pd.DataFrame) -> pd.DataFrame:
    """Seconds from stop k to stop k+1 for every bus trip, with when it happened."""
    pas = pas.sort_values(["door", "route", "trip", "order"])
    nxt = pas.groupby(["door", "route", "trip"]).shift(-1)
    seg = pas.assign(next_order=nxt["order"], next_t=nxt["t"]).dropna(subset=["next_t"])
    seg = seg[seg.next_order == seg.order + 1]
    seg = seg.assign(seconds=(seg.next_t - seg.t).dt.total_seconds())
    return seg[["direction", "order", "t", "seconds"]]


def day_type(t: datetime) -> str:
    return "weekend" if t.weekday() >= 5 else "weekday"


@dataclass
class History:
    """Usual stop-to-stop times. Most specific bucket with enough data wins:
    (direction, segment, day type, hour) -> (direction, segment, hour) -> (direction, segment)."""

    seg: pd.DataFrame
    min_n: int = 5

    def __post_init__(self):
        s = self.seg.assign(hour=self.seg.t.dt.hour, day=self.seg.t.map(day_type))
        self.levels = [
            s.groupby(["direction", "order", "day", "hour"]).seconds,
            s.groupby(["direction", "order", "hour"]).seconds,
            s.groupby(["direction", "order"]).seconds,
        ]
        self.keys = [
            lambda d, k, t: (d, k, day_type(t), t.hour),
            lambda d, k, t: (d, k, t.hour),
            lambda d, k, t: (d, k),
        ]
        self.tables = [(lv.median(), lv.count()) for lv in self.levels]

    def usual(self, direction: str, order: int, when: datetime) -> float | None:
        for (med, cnt), key in zip(self.tables, self.keys):
            k = key(direction, order, when)
            if k in cnt.index and cnt[k] >= self.min_n:
                return float(med[k])
        return None


def live_factor(seg: pd.DataFrame, hist: History, direction: str, orders: range, now: datetime) -> tuple[float, int]:
    """How much slower than usual the given stretch is right now.

    Ratio of recent travel times to their usual values, over segments in the
    stretch traversed by any bus in the last LIVE_WINDOW_MIN minutes. Median of
    ratios, so one bus stuck behind a delivery van doesn't set the factor.
    Returns (factor, number of segments it rests on); factor 1.0 when there is
    too little recent data to say.
    """
    recent = seg[(seg.direction == direction) & seg.order.isin(list(orders))
                 & (seg.t > now - timedelta(minutes=LIVE_WINDOW_MIN)) & (seg.t <= now)]
    ratios = []
    for r in recent.itertuples():
        u = hist.usual(direction, r.order, r.t)
        if u:
            ratios.append(r.seconds / u)
    if len(ratios) < MIN_LIVE_SEGMENTS:
        return 1.0, len(ratios)
    return float(np.median(ratios)), len(ratios)


def spread(seg: pd.DataFrame, direction: str, orders: range) -> tuple[float, float]:
    """Typical early/late scatter of a multi-stop trip, as fractions of its median:
    10th and 90th percentile of (trip time / median trip time) over history."""
    s = seg[(seg.direction == direction) & seg.order.isin(list(orders))]
    if s.empty:
        return 0.8, 1.3  # no history yet: a deliberately wide guess
    per_seg = s.groupby("order").seconds
    ratio = (s.seconds / s.order.map(per_seg.median())).clip(0.2, 5)
    # segments of one trip are positively correlated; use per-segment ratio quantiles as a trip-level proxy
    return float(ratio.quantile(0.1)), float(ratio.quantile(0.9))


def find_stop(stops: pd.DataFrame, name: str) -> pd.DataFrame:
    key = norm(name)
    hit = stops[stops.name.map(norm) == key]
    return hit if not hit.empty else stops[stops.name.map(norm).str.contains(key, regex=False)]


def reached_times(pas: pd.DataFrame) -> dict[tuple[str, int], datetime]:
    """(door, stop order) -> when that bus last reached that stop. Used to subtract the time a
    bus has already spent on its current segment - without it, a bus that left a stop three
    minutes ago is predicted as if it just left (a bug the jam test caught)."""
    last = pas.sort_values("t").groupby(["door", "order"]).t.last()
    return {(str(d), int(o)): t for (d, o), t in last.items()}


def predict(line: str, stops: pd.DataFrame, latest: pd.DataFrame, seg: pd.DataFrame, hist: History,
            board: str, dest: str, walk_min: float, now: datetime,
            reached: dict | None = None) -> list[dict]:
    """Every bus of `line` that will pass `board` before `dest`: when it reaches each, and when to leave.
    `reached` (from reached_times) lets the first segment count only the time still left on it."""
    out = []
    b_rows, d_rows = find_stop(stops, board), find_stop(stops, dest)
    for direction in sorted(set(b_rows.direction) & set(d_rows.direction)):
        b = int(b_rows[b_rows.direction == direction].order.min())
        d_candidates = d_rows[(d_rows.direction == direction) & (d_rows.order > b)]
        if d_candidates.empty:
            continue  # this direction reaches the destination before the boarding stop
        d = int(d_candidates.order.min())
        order_of = {r.stop: r.order for r in stops[stops.direction == direction].itertuples()}

        for bus in latest[latest.route.map(direction_of) == direction].itertuples():
            k = order_of.get(str(bus.near_stop))
            if k is None or k > b:
                continue  # unknown position, or already past my stop
            usual_to_board = [hist.usual(direction, o, now) for o in range(k, b)]
            usual_ride = [hist.usual(direction, o, now) for o in range(b, d)]
            if any(u is None for u in usual_to_board + usual_ride):
                continue  # not enough history for this stretch yet
            factor, n_live = live_factor(seg, hist, direction, range(max(0, k - 5), d), now)
            lo, hi = spread(seg, direction, range(k, d))
            # time already spent on the current segment (bus k -> k+1) comes off it, but never below
            # 10% of it: a bus "overdue" for the next stop is late, not already there. It comes off
            # whichever leg contains that segment - the trip to my stop, or (bus at my stop) the ride.
            since = reached.get((str(bus.door), k)) if reached else None
            spent = 0.0
            if since is not None:
                first = (usual_to_board or usual_ride)[0] * factor
                spent = min(max(0.0, (now - since).total_seconds()), 0.9 * first)
            to_board = max(0.0, sum(usual_to_board) * factor - (spent if usual_to_board else 0.0))
            ride = sum(usual_ride) * factor - (0.0 if usual_to_board else spent)
            at_board = now + timedelta(seconds=to_board)
            early = now + timedelta(seconds=to_board * lo)
            out.append({
                "line": line, "bus": bus.door, "direction": direction, "board": board,
                "stops_away": b - k,
                "at_board": at_board, "at_board_early": early, "at_board_late": now + timedelta(seconds=to_board * hi),
                "at_dest": at_board + timedelta(seconds=ride),
                "leave_by": early - timedelta(minutes=walk_min),
                "traffic_factor": round(factor, 2), "live_segments": n_live,
            })
    return sorted(out, key=lambda r: r["at_dest"])
