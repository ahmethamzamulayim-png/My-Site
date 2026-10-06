# Bus: when should I leave?

For my trip: line **17** or **2**, from **Kazasker** or **Ayşekadın**, to **Marmara Üniversitesi**
(set in [`routes.yaml`](routes.yaml), with my walking time to each stop).

```
python -m bus.collect --stops-only   # first: fetch the lines' stop lists, check the stop names match
python -m bus.collect                # then: run all day on an always-on machine (systemd note in the file)
python -m bus.leave                  # any time: which bus, from which stop, leave by when
```

```
08:00  →  Marmara Üniversitesi

line  from         leave by        bus at stop  arrive  traffic
   2  Ayşekadın    08:04  08:13–08:16 (08:14)  08:31  ×2.33
   ...
```

**How:** `collect` logs every bus on my lines every 30 s (İETT `GetHatOtoKonum_json`). `leave` turns that
into when each bus reached each stop, learns usual stop-to-stop times by weekday/hour, and corrects them with
how slow the buses just ahead are running *right now* (the traffic factor). "Leave by" is planned against the
bus's *early* arrival, so I catch it 9 times in 10.

**Tested on a simulated line with a traffic jam** (`tests/test_bus.py`): with the live correction a bus 2 stops
away was predicted 21 s early; history alone - like the kiosks - said 2.5 min early (8 min for a bus 3 stops away).

**Not yet done / known limits**
- Never run against the real service (it was unreachable from where this was written). First run = first test;
  if the SOAP namespace or field names differ, fix them in `iett.py`.
- **Line codes and stop names unverified:** check `--stops-only` lists Kazasker, Ayşekadın and Marmara
  Üniversitesi on lines 17 and 2.
- **Only buses already on the road are predicted.** A bus that hasn't left its first stop needs the planned
  departure times (İETT's planned-schedule service) - next step.
- Passage times are only as precise as the polling (~30 s).
- Walking times in `routes.yaml` are placeholders - measure them.
