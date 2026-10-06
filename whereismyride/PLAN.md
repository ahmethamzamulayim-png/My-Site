# WhereisMyRide — plan

**Question:** where is my M4 train right now, and how far can the official timetable be trusted to answer that?

**Approach:** place every train on the line from Metro İstanbul's published timetable, then measure reality with
my own phone's sensors on my daily M4 rides, and only build something cleverer if the measurements say the
timetable is off by enough to matter.

No public source gives live Istanbul metro positions. The timetable API exists and is free; actual positions
are not published. So this project produces two things: a *scheduled* position map, and a *measured* answer to
how much reality drifts from it.

---

## Phase 0 — Repo setup

```
WhereisMyRide/
  PLAN.md               this file
  README.md
  network/              M4 stations, order, coordinates, track distances (generated, committed)
  timetable/            daily GetTimeTable snapshots (generated, committed)
  rides/                one folder per ride: phyphox CSV export + ride.yaml   (PRIVATE — see Privacy)
  analysis/             Python: stop detection, segment times, speed profiles, timetable comparison
  web/                  the live scheduled-position map (later moves into my-site)
  proxy/                Deno proxy: caches the timetable API, serves it with CORS
```

Python 3.12 + pandas/numpy/scipy for analysis, same as `ist-delay-dataset`. Repo stays **private** until
Privacy below is handled.

## Phase 1 — The network (static data)

- Pull M4's station list, IDs and order from `GetStations`. Confirm the line's current end stations from the
  API instead of from memory.
- Pull the M4 track geometry from OpenStreetMap (Overpass query on the `route=subway` relation) and compute the
  **along-track distance** between consecutive stations. Straight-line distance is wrong for curved track, and
  every speed number later depends on this.
- Output: `network/m4.json` — station id, name, lat/lng, cumulative track distance (m).

**Done when:** the station list matches the M4 map and total line length is within a few % of the published figure.

## Phase 2 — The timetable

Endpoints (public, no key, per the İBB open data portal; **not yet verified from my own network**):

| endpoint | method | use |
|---|---|---|
| `GetStations` | GET | station list |
| `GetDirectionsByLineIdAndStationId` | POST | direction ids per station |
| `GetTimeTable` | POST | today's departures for a station + direction, `HH:MM` |
| `GetServiceStatuses` | GET | disruption notices |

Base URL: `https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/`

- Fetch every M4 station × both directions once a day; store as `timetable/YYYY-MM-DD.json`.
- The gateway reportedly returns **503 under rapid requests** — fetch sequentially with a delay and retry.
- Reconstruct individual **trips**: chain each departure at station *n* to the matching departure at
  station *n+1*, giving scheduled run time per segment. (Done before by `railisland-world` for this API.)
- Check whether weekday / Saturday / Sunday timetables differ; store each.

**Done when:** every M4 trip of a weekday is reconstructed end-to-end, and the scheduled segment times are
consistent across the day (or the differences are explained, e.g. peak vs. off-peak).

## Phase 3 — Logging my rides

**App:** phyphox (free, RWTH Aachen). Record in one session (at minimum the first one):
- **Linear acceleration** (gravity already removed) — movement and jolts
- **Magnetometer** — traction motors spike it on acceleration; second witness for departures
- **Barometer** — depth changes, tunnel sections

**Protocol, every ride:**
1. Start recording **once on board, before the doors close**; stop after the train has stopped at your
   station, before walking off. (Walking on a platform looks like a train moving.)
2. Phone in the **same position the whole ride** (flat on lap, or in a bag on the knees). Handling the phone
   reads as motion.
3. For the first few rides, note the clock time at a couple of stations — ground truth for the stop detector.
4. Export CSV, drop it in `rides/YYYY-MM-DD_HHMM_<dir>/` with a `ride.yaml`:

```yaml
date: 2026-10-07
line: M4
direction: <end station name>
board: <station>
alight: <station>
phone_position: lap-flat
start_clock: "08:12:30"   # wall clock when recording started — needed to line up with the timetable
notes: crowded, 1 min hold at Ünalan
```

`start_clock` matters most: the CSV's time axis starts at 0, and all timetable comparison hangs on knowing
real wall-clock time. Take it from the phone's clock at start, to the second.

**Target:** 2 rides/day (commute both ways) → ~40 rides in 4 weeks, covering peak and off-peak.

## Phase 4 — Analysis

Per ride, `analysis/ride.py`:

1. **Stop detection.** Rolling variance of acceleration magnitude: still = stopped, sustained vibration = moving.
   Confirm with the magnetometer. Output: list of (arrive, depart) times.
2. **Align stops to stations.** Metros don't skip stations, so the k-th stop after boarding is the k-th station.
   Check the count against `board`→`alight`; a mismatch flags a detection error (or an unscheduled stop in a
   tunnel — worth recording either way).
3. **Segment times + dwell times** — wall-clock, to the second.
4. **Average speed per segment** = track distance (Phase 1) ÷ moving time. No integration, no drift.
5. **Speed profile per segment.** Integrate acceleration *only between two stops*; velocity is zero at both ends,
   so the sensor's constant bias can be solved for and removed. Expect roughly ±10%. Never integrate across a
   whole ride — bias makes it meaningless after a minute or two.
6. **Timetable comparison.** Match each measured departure to the nearest scheduled departure at that station;
   record the deviation (seconds, signed).

Across rides, `analysis/summary.py`: deviation distribution by station, time of day, weekday; dwell time vs.
crowding; per-segment speed profiles overlaid.

**Self-check:** `tests/` — synthetic rides with known answers, including a bumped phone and a large sensor
bias; detected stops must land within 2 s (currently < 1 s). On real rides: the hand-noted station times.

## Phase 4b — Ride comfort

Same rides, second question: *how does the ride feel, and where is it worst?*

- Per run: traction/braking peak (m/s²), jerk at start and stop (m/s³), ISO 2631-1 weighted vibration
  (vertical Wk, horizontal Wd; vertical found from the gravity direction the app records).
- Across rides (`analysis.summary`): by line, by vehicle (car number typed in the app), by stretch of track.
- A stretch that is rough on every train is the track; a train that is rough on every stretch is the train.
  That separation is the result worth showing to an operator.
- Phone ≠ seat sensor: compare like with like (`phone_position`), don't quote ISO compliance.

## Phase 5 — Decision gate

After ~40 rides, answer one question with data:

> What fraction of M4 departures happen within 60 s of the timetable?

- **≥ 95%** → the timetable *is* the position. Build the map on it and say so with the measured number.
- **Lower, but predictable** (e.g. always late in the evening peak, or at specific stations) → add a correction
  table from my own measurements.
- **Lower and unpredictable** → the map can only be honest about uncertainty; show trains as ranges, not points.

Write this up either way. "The timetable is accurate to X s, 95% of the time, measured over N rides" is a
result nobody has published.

## Phase 6 — The map

- `proxy/`: Deno worker (same pattern as the THY globe proxy) — fetches the timetable once a day, caches it,
  serves it with CORS, polls `GetServiceStatuses`.
- `web/`: M4 drawn from the OSM geometry; each train interpolated between stations every second from the
  reconstructed trips (+ Phase 5 correction if any). Disrupted lines greyed out with the notice text.
- Clear label: **scheduled position**, with the measured accuracy from Phase 5.
- Moves into my-site as `/whereismyride` (+ `/tr/` version).
- Other lines later, using the same code; my measurements only cover M4, so other lines are timetable-only
  and labelled as such.

## Privacy

Every ride file is a timestamped record of where I am on a weekday morning. The raw rides stay in the private
repo. Publish only aggregates (deviation stats, speed profiles without dates/times). Same rule as the IST
dataset: raw private, summaries public.

## Risks / unknowns

| risk | check |
|---|---|
| API unreachable or changed since the 2021 portal entry | First task of Phase 2: one call each endpoint, save the responses |
| API timetable is a template, not the day's real plan | Compare to the departure screens at my station for a few days |
| Stop detection confused by slow crawl / signal holds | Station markers on the first rides; tune thresholds on those |
| Phone position drifts mid-ride | Note it in `ride.yaml`; drop the segment, not the ride |
| CBTC lines are so punctual the answer is boring | That's still the answer — and it makes the map trustworthy |

## First week

1. Create the repo; add this plan.
2. Phase 1 + first API calls (Phase 2, step 1).
3. Install phyphox; record the first 3–4 commutes with station markers.
4. Send the first CSV — write the stop detector against real data, not imagined data.
