"""Arrive-by planning and the scorecard, on a simulated line with random jam mornings.

    python tests/test_bus_plan.py
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bus.model import passages, plan_arrival, replay, trips_between  # noqa: E402
from bus.score import report, score_arrive_by, score_next_bus  # noqa: E402
from bus.sim import simulate, stops  # noqa: E402

START = datetime(2026, 8, 31)  # Monday
DAYS = 35
rng = np.random.default_rng(1)
# about one morning in three jams up (x2 between 07:30 and 09:30)
JAMS = [(START + timedelta(days=d, hours=7, minutes=30), START + timedelta(days=d, hours=9, minutes=30), 2.0)
        for d in range(DAYS) if rng.random() < 0.33]
PINGS, TRUTH = simulate(START, DAYS, jam=JAMS, seed=3)
ST = stops()
PAS = passages(PINGS, ST)
TRIPS = trips_between(PAS, ST, "Ayşekadın", "Marmara Üniversitesi")
TARGET = datetime(2026, 10, 5, 9, 0)  # a Monday after 5 weeks of history


def test_trips_found():
    assert len(TRIPS) > 200 and (TRIPS.t_dest > TRIPS.t_board).all()


def test_more_confidence_means_leaving_earlier():
    p50 = plan_arrival(TRIPS, TARGET, 9, 3, confidence=0.5)
    p90 = plan_arrival(TRIPS, TARGET, 9, 3, confidence=0.9)
    assert p50 and p90 and p90["leave"] < p50["leave"], (p50, p90)
    assert p90["on_time_rate"] >= 0.9


def test_plan_replays_honestly():
    # the promised rate must be what replaying those very days gives
    p = plan_arrival(TRIPS, TARGET, 9, 3, confidence=0.9)
    days = sorted(d for d in TRIPS.day.unique() if d < TARGET.date() and datetime.combine(d, TARGET.time()).weekday() < 5)
    ok = [replay(TRIPS, d, p["leave"], 9, 3) <= datetime.combine(d, TARGET.time()) for d in days]
    assert abs(np.mean(ok) - p["on_time_rate"]) < 1e-9


def test_arrive_by_keeps_its_promise_on_unseen_days():
    days = sorted(TRIPS.day.unique())[-12:]
    ab = score_arrive_by(TRIPS, 9, 3, days, confidence=0.9)
    assert len(ab) >= 20
    # 90% promised; with ~1 in 3 bad mornings and a few dozen trials, accept 75%+
    assert ab.on_time.mean() >= 0.75, ab.on_time.mean()


def test_next_bus_scorecard_live_beats_kiosk_on_jam_days():
    jam_days = sorted({j[0].date() for j in JAMS if j[0].date() >= (START + timedelta(days=DAYS - 8)).date()})[:2]
    assert jam_days, "need at least one jam day in the last week"
    nb = score_next_bus(ST, PINGS, "2", "Ayşekadın", "Marmara Üniversitesi", jam_days, step_min=15,
                        window=("07:45", "09:15"))
    assert len(nb) >= 5
    assert nb.error_min.abs().median() < nb.kiosk_error_min.abs().median(), nb[["error_min", "kiosk_error_min"]].describe()
    text = report(nb, score_arrive_by(TRIPS, 9, 3, sorted(TRIPS.day.unique())[-5:]), 0.9)
    assert "NEXT BUS" in text and "ARRIVE BY" in text


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
