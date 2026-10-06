"""Bus predictor on a simulated line with a known traffic jam.

    python tests/test_bus.py
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bus.iett import parse_bus_positions, parse_line_stops  # noqa: E402
from bus.model import History, live_factor, norm, passages, predict, reached_times, segment_times  # noqa: E402
from bus.sim import simulate, stops  # noqa: E402

START = datetime(2026, 9, 21)  # a Monday; 14 days of history
JAM = (datetime(2026, 10, 5, 7, 30), datetime(2026, 10, 5, 10, 0), 2.5)
NOW = datetime(2026, 10, 5, 8, 0)


def _data():
    pings, truth = simulate(START, 15, jam=JAM)
    pings = pings[pings.t <= NOW]
    st = stops()
    seg = segment_times(passages(pings, st))
    return pings, truth, st, seg, History(seg)


def test_names_match_whatever_the_spelling():
    assert norm("Ayşekadın") == norm("AYŞEKADIN") == "AYSEKADIN"
    assert norm("Marmara Üniversitesi") == "MARMARA UNIVERSITESI"


def test_passages_match_true_stop_times():
    pings, truth, st, _, _ = _data()
    pas = passages(pings, st)
    tr = truth[truth.t <= NOW].set_index(["door", "order", "trip_start"])
    # match each passage to the true time of the same bus at the same stop, nearest trip
    errs = []
    for r in pas.sample(400, random_state=0).itertuples():
        cand = truth[(truth.door == r.door) & (truth.order == r.order)]
        errs.append(min(abs((cand.t - r.t).dt.total_seconds())))
    errs = pd.Series(errs)
    # pings every 30 s and "last stop passed" reporting -> passages land up to ~30 s late
    assert errs.median() < 30 and errs.quantile(0.9) < 45, errs.describe()
    del tr


def test_history_learns_the_usual_segment_time():
    *_, hist = _data()
    u = hist.usual("G", 5, datetime(2026, 10, 1, 8, 0))
    assert 80 < u < 100, u  # simulated segments take 90 s


def test_live_factor_sees_the_jam():
    _, _, _, seg, hist = _data()
    f, n = live_factor(seg, hist, "G", range(1, 13), NOW)
    assert n >= 2 and 2.0 < f < 3.0, (f, n)
    f_calm, _ = live_factor(seg, hist, "G", range(1, 13), datetime(2026, 10, 2, 8, 0))
    assert 0.8 < f_calm < 1.2, f_calm


def test_prediction_beats_history_alone_in_a_jam():
    pings, truth, st, seg, hist = _data()
    latest = pings[pings.t > NOW - timedelta(minutes=2)].sort_values("t").groupby("door").tail(1)
    # board at Ayşekadın (6th stop): far enough down the line for buses several stops away
    reached = reached_times(passages(pings, st))
    opts = predict("2", st, latest, seg, hist, "Ayşekadın", "Marmara Üniversitesi", 9, NOW, reached)
    assert opts, "no prediction"
    board = int(st[(st.direction == "G") & (st.name == "AYŞEKADIN")].order.iloc[0])
    checked = 0
    for o in opts:
        if o["stops_away"] < 1:
            continue
        cand = truth[(truth.door == o["bus"]) & (truth.order == board) & (truth.t > NOW)]
        if cand.empty:
            continue
        true_at = cand.t.min()
        live_err = abs((o["at_board"] - true_at).total_seconds())
        # same prediction without the live traffic correction (factor 1)
        hist_only = NOW + (o["at_board"] - NOW) / o["traffic_factor"]
        hist_err = abs((hist_only - true_at).total_seconds())
        assert live_err < hist_err, (o, true_at)
        assert live_err < 0.25 * (true_at - NOW).total_seconds() + 60, (live_err, o)
        assert o["leave_by"] <= o["at_board_early"] - timedelta(minutes=9)
        checked += 1
    assert checked >= 2, checked


def test_a_bus_arrives_at_the_same_time_whichever_stop_i_board_at():
    pings, _, st, seg, hist = _data()
    latest = pings[pings.t > NOW - timedelta(minutes=2)].sort_values("t").groupby("door").tail(1)
    reached = reached_times(passages(pings, st))
    a = {o["bus"]: o["at_dest"] for o in predict("2", st, latest, seg, hist, "Kazasker", "Marmara Üniversitesi", 6, NOW, reached)}
    b = {o["bus"]: o["at_dest"] for o in predict("2", st, latest, seg, hist, "Ayşekadın", "Marmara Üniversitesi", 9, NOW, reached)}
    both = set(a) & set(b)
    assert both
    for bus in both:
        assert abs((a[bus] - b[bus]).total_seconds()) < 1, (bus, a[bus], b[bus])


def test_parsers_on_documented_shapes():
    rows = parse_bus_positions('[{"kapino":"C-231","boylam":"29.10","enlem":"41.04","hatkodu":"15B",'
                               '"guzergahkodu":"15B_G_D0","yon":"ÜSKÜDAR","son_konum_zamani":"2023-01-23 12:41:54",'
                               '"yakinDurakKodu":215682}, {"kapino":"bad"}]')
    assert len(rows) == 1 and rows[0]["near_stop"] == "215682" and rows[0]["route"] == "15B_G_D0"
    import xml.etree.ElementTree as ET
    xml = ("<r><Table><HATKODU>2</HATKODU><YON>G</YON><SIRANO>2</SIRANO><DURAKKODU>11</DURAKKODU>"
           "<DURAKADI>B</DURAKADI></Table><Table><HATKODU>2</HATKODU><YON>G</YON><SIRANO>1</SIRANO>"
           "<DURAKKODU>10</DURAKKODU><DURAKADI>A</DURAKADI></Table></r>")
    st = parse_line_stops(ET.fromstring(xml))
    assert [s["name"] for s in st] == ["A", "B"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
