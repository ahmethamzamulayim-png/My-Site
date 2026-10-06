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

---

## Field tests

See [TESTING.md](TESTING.md): what to check on real rides, in order, with pass criteria and a results log.

## Ideas and open questions — nothing here is lost

### Next steps (in order)
1. Create the `WhereisMyRide` repo; move this folder there with its history; enable GitHub Pages → app link.
2. TESTING.md T0, T1, T11 on my own M4 commutes.
3. Run the timetable fetcher and `build_network.py M4 --osm` from a laptop (T6, T7).
4. Two-phone tests with one friend (T2–T4).
5. Consent text + pilot with 3–5 friends.

### To verify (claims not yet checked against a primary source)
- ISO 2631-1 Table 3 weighting values in `tests/test_comfort.py` were typed from memory — check against
  a real copy (university library). Wd at 10 Hz is the known suspect (remembered 212, formula gives 202).
- The timetable API's request formats come from mdemirer/sonraki-tren, not from running it myself.
- İBB open-data licence terms (station data says CC BY 4.0; the portal also has its own İBB licence) —
  read before any commercial use.
- Whether Metro İstanbul's or İBB's apps show live station crowding (could be a minute-level signal).

### Hardware: phones are the crowd, the Pi box is the reference
- **Native Android app (decided):** every phone sensor — accelerometer, gyroscope, magnetometer, barometer,
  light, proximity — recording with the screen off. The web app stays only as a quick prototype.
- **Raspberry Pi Zero W reference box** ([HARDWARE.md](HARDWARE.md) has the shopping list): kHz vibration
  (wheel flats, rail corrugation — the bearing-fault idea applied to a train), floor-mounted ISO comfort,
  CO₂ (crowding), PM2.5 (metro dust), high-resolution pressure. Rides with box + phone together give a
  per-position correction for every phone recording.
- **Gyroscope path tracing:** turn rate × speed → the track's shape between stations, with gyro drift
  removed by forcing each path to end at the next station (same trick as the speed bias). Gives curve radius
  (speed ÷ turn rate) and, with the measured sideways acceleration, how much of the curve force the track's
  banking cancels. Needs the phone fixed relative to the car (bag on the floor).

### Ideas backlog
- **Magnetometer** as a second witness for departures (traction motors spike it); **barometer** for depth
  and tunnel sections (M-Loc used both to tell stations apart); **light** for platform vs. tunnel;
  **proximity** to record pocket/bag automatically; **microphone loudness** (never audio) for noise comfort.
- **Scheduled-position live map** on the portfolio site (Phase 6), with disrupted lines greyed out from
  `GetServiceStatuses`, labelled with the measured timetable accuracy.
- **Track-condition monitoring:** the same stretch getting rougher over weeks, on every train → maintenance
  signal. Needs T9 (repeatability) first to know what change is real.
- **Fleet comparison:** car numbers → train types; same track, different trains → which fleet rides worse.
- **Punctuality dataset:** "the M4 timetable is accurate to X s, 95% of the time, over N rides" — not
  published anywhere today.
- **Crowd/turnstile idea:** infer arrivals from station entry surges. Not possible with public data (hourly,
  published later, tap-in only). Would need raw Istanbulkart tap timestamps — ask İBB through the university.
- **Lines the API doesn't cover:** Marmaray, M11, T2, T6, F2, F3, metrobüs — find other sources, or
  measurement-only for those.
- **Crowding as a feature:** dwell time vs. how full the train felt (a 1–3 rating in the app?).

### Borrow from similar projects (ideas freely; code/data only with licence check or the author's OK)
- **Transit app GO:** one tap to contribute, and contributors see live trains in return — the reason
  people keep using it.
- **M-Loc / SubwayPS / MetroEye (research):** extra sensors to identify stations; ~70 rides was enough for
  SubwayPS — a realistic target for me + friends.
- **Rayİst / sonraki-tren:** disruption handling via `GetServiceStatuses`; sonraki-tren's API retry and
  caching notes. Worth messaging its author — they solved this API's quirks and may want punctuality data back.

### Where it could go
- **Portfolio / paper / student competition** — near-certain value.
- **Data, not a consumer app:** punctuality data (journalists, planners, Moovit/Google), ride-comfort and
  track-condition data (operators, maintenance contractors, train makers). Few buyers, slow sales — a
  hypothesis to test once the data shows something real.
- **Before any of it:** KVKK compliance for friends' rides; never use "Metro İstanbul" name or logo in branding.
