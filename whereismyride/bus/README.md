# Bus: when should I leave?

**The question:** I must be at Marmara Üniversitesi by a given time — when do I leave home?
For my trip: line **17** or **2**, from **Kazasker** or **Ayşekadın** (set in [`routes.yaml`](routes.yaml),
with walking times to each stop and from the destination stop).

```
python -m bus.collect --stops-only     # first: fetch the lines' stop lists, check the stop names match
python -m bus.collect                  # then: run all day on an always-on machine (systemd note in the file)

python -m bus.leave --arrive-by 09:00  # THE answer: leave home by when, from which stop
python -m bus.leave                    # curiosity: the next buses at my stops, live
python -m bus.score                    # how well does it work? graded against what really happened
```

```
To be at Marmara Üniversitesi by 09:00 on Fri 02 Oct (90% of days):

→ leave by 08:29, walk to Ayşekadın    on time 90% of 20 past days · usually 9 min early, worst day 9 min LATE
  leave by 08:26, walk to Kazasker     on time 95% of 20 past days · usually 9 min early, worst day 9 min LATE
```

**Arrive-by works by replaying history:** for each past day like today, "had I left at 08:29, which bus would I
have caught, and when would I have arrived?" — then the latest leave time that worked on 90% of those days.
Waiting, bunching, traffic and bad days are all in it; nothing is modelled. At a stop I take whichever of 17
and 2 comes first, so both lines' trips are pooled. When the target is within 90 min it also checks the
buses on the road right now.

**Scorecard** (`bus.score`) — every prediction made with only the data that existed at that moment:

```
NEXT BUS — how far off, by how far ahead it was predicted (minutes)       [simulated data]
   ahead     n  typical error  within 1 min  within 2 min  in window  kiosk-style typical
     0-5   125          0.5 m          94%          98%        83%                0.4 m
    5-10    42          0.5 m          74%          88%        93%                1.0 m
   10-20     7          2.0 m          29%          57%        86%                6.5 m

ARRIVE BY — promised 90% on time
actually on time: 90% of 48 planned trips · usually 8 min early · latest: 9 min late
→ about right
```

**Next bus, how:** `collect` logs every bus on my lines every 30 s (İETT `GetHatOtoKonum_json`). `leave` turns that
into when each bus reached each stop, learns usual stop-to-stop times by weekday/hour, and corrects them with
how slow the buses just ahead are running *right now* (the traffic factor). "Leave by" is planned against the
bus's *early* arrival, so I catch it 9 times in 10.

**Tested on a simulated line with traffic jams** (`tests/test_bus.py`, `tests/test_bus_plan.py`): with the live correction a bus 2 stops
away was predicted 21 s early; history alone - like the kiosks - said 2.5 min early (8 min for a bus 3 stops away).

**Not yet done / known limits**
- Never run against the real service (it was unreachable from where this was written). First run = first test;
  if the SOAP namespace or field names differ, fix them in `iett.py`.
- **Line codes and stop names unverified:** check `--stops-only` lists Kazasker, Ayşekadın and Marmara
  Üniversitesi on lines 17 and 2.
- **Only buses already on the road are predicted.** A bus that hasn't left its first stop needs the planned
  departure times (İETT's planned-schedule service) - next step.
- Passage times are only as precise as the polling (~30 s).
- Walking times in `routes.yaml` are placeholders - measure them (`dest_walk_min` too: stop → classroom).
- Arrive-by needs ~5 past days of the same kind (weekday/weekend) before it answers; more = steadier.
- `bus.score` is slowish (replays every 10 min of every morning) - fine for a daily/weekly check.
