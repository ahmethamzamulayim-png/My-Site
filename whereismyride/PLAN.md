# WhereisMyRide — plan

**Question:** where is my M4 train right now, and how far can the official timetable be trusted to answer that?

**Approach:** place every train on the line from Metro İstanbul's published timetable, then measure reality with
my own phone's sensors on my daily M4 rides, and only build something cleverer if the measurements say the
timetable is off by enough to matter.

No public source gives live Istanbul metro positions. The timetable API exists and is free; actual positions
are not published. So this project produces two things: a *scheduled* position map, and a *measured* answer to
how much reality drifts from it.

---

## Why this exists

I'm a mechanical engineering student. I like to take apart every system I meet — how it works, what limits
it, how it could be better. Istanbul's transport is the system I use every day, so this project is my lab for
dissecting it. The useful tools ("when do I leave?", next bus, coverage map) are by-products; the point is
understanding.

Every subsystem gets the same treatment, logged in [`dissections/`](dissections/):
**how it works → measure it → what limits it → how could it be better** (with the data to estimate the gain).

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

## Mechanical-engineering track — vibration, wear and tear

The transport features answer "when do I leave"; this track answers "what is all this riding doing to the
vehicles and the track". Same recordings, different questions.

**Built and tested (metro):**
- ISO 2631-1 ride comfort (Wk vertical, Wd horizontal), traction/braking peaks, jerk at start and stop
- summaries by line, by train (car number), by stretch of track; a stretch getting rougher over weeks = wear signal

**Planned, tests written (Pi box, TESTING.md T15, T17):**
- wheel flats — impacts at speed ÷ wheel circumference (the bearing-fault idea, BPFO, applied to a train)
- rail corrugation — fixed-wavelength tone, frequency rising with speed
- curve radius and banking (cant deficiency) from the gyroscope

**New ideas:**
1. **Fatigue via rainflow counting** — the standard ME method: acceleration time history → load cycles →
   relative fatigue damage per km (Miner's rule, S-N slope as a parameter). Compare lines / stretches / buses:
   which route wears a vehicle's suspension fastest. Relative, not a lifetime prediction.
2. **Brake-wear hot spots** — count braking events and their severity per stretch; where every vehicle brakes
   hard every time is where brakes (and, on the metro, rails) wear.
3. **Flange-wear curves** — gyroscope radius × speed × lateral acceleration × squeal loudness (mic, loudness
   only): tight, fast, squealing curves are where flanges and rails wear.
4. **Road roughness from the bus** — vertical-vibration spectrum → ISO 8608 road class; GPS works above ground
   → a roughness / pothole map of my bus route. Plus bus ride comfort with the same ISO 2631 code.
5. **Driving smoothness per bus line** — braking and jerk per line/driver, same measure as metro trains.

Reuse: `analysis/comfort.py` is vehicle-agnostic; buses need a stop detector that tells bus stops from traffic
stops (GPS + the line's stop list does that).

## Scope: all Istanbul transport — personal tool first

Direction: one app for every mode I use, built first as my own daily tool (published or not, it pays off
daily, and daily use is the best test).

**Personal payoffs:** when to leave (from *my* measured walks, transfers and line punctuality) · transfer
reliability (e.g. M4 → Marmaray at Ayrılık Çeşmesi) · which car to board for the nearest exit/transfer ·
signal gaps on my routes · disruption alerts for my lines · a travel log (time per week, lines, trends).

**Modes** (sources from memory where marked — verify):
| Mode | Live position source | What measurement adds |
|---|---|---|
| Metro, tram, funicular | none public — measured | everything in this plan |
| Buses, metrobüs | İETT live bus positions + GTFS (verify on the open-data portal) | comfort, crowding, accuracy of predicted arrivals |
| Marmaray | no open API known | same sensor method as metro |
| Ferries | **AIS** — ships broadcast position publicly, like ADS-B for planes; RTL-SDR dongle (~$30) on the Pi (check Turkish rules before a permanent receiver) | crowding, comfort, crossing times |

**Keeping a mega-app finishable:**
1. **One data model:** a journey = legs (mode, line, from, to); every leg uses the same recording and analysis.
   A new mode = a new data source, not a new app.
2. **Add modes in order of my own use:** M4 first, then the next most-used line.
3. **Personal first:** a phone and a folder of rides. Accounts, servers, polish only if publishing.

### Buses: "when should I leave?" (personal Citymapper/Moovit, done properly)

Problem: kiosks and apps say "1 min" for a bus 15 min away — they predict from *where the bus is*, not from
*how buses are moving on that road right now*.

1. **Log my routes' buses all day** — İETT bus positions (believed to be via İBB's older web services;
   verify the current endpoint and its usage limits), polled every 30–60 s → when each bus passed each stop.
2. **Historical travel times between stops** by hour/weekday — the IST-board method: most specific history
   with enough data, else fall back to broader averages.
3. **Live correction from the buses ahead:** the last buses on the same stretch *are* the traffic sensor
   (vehicles as probes). Catches rain, accidents, match days that history misses.
4. **Predict a range, not a point:** "leave at 08:07 → catch the 08:15 nine times in ten", using my measured
   walk time to the stop.
5. **Grade it on myself:** the native app detects boarding (walking → vehicle motion); every trip scores the
   prediction.

Bonuses: log the official/kiosk prediction next to reality → "how wrong is the official arrival time?"
(a result like the IST board). Traffic data later if needed: İBB traffic-index / segment-speed datasets
(unverified); commercial APIs (Google, TomTom) cost money and usually forbid storing data.

**The real goal: "I must be there at T — when do I leave?"** Built as `bus.leave --arrive-by`: replays past
comparable days ("had I left then, which bus would I have caught?") and gives the latest leave time that
arrived on time on 90% of them. Plus `bus.leave` (next buses, live) and `bus.score` (graded against what
really happened, no peeking: next-bus error by minutes ahead vs a kiosk-style baseline; does the 90% promise
come true ~90% of the time). Extends to multi-leg trips (bus → metro) by replaying each leg in sequence.

**Built** (`bus/`, tested on a simulated line with jams): collector, stop-passage extraction, history with
fallbacks, live traffic factor, "leave by" on the early quantile — for lines 17 and 2, Kazasker / Ayşekadın →
Marmara Üniversitesi. Next: run it for real; add planned departures for buses not yet on the road; grade the
official/kiosk prediction.

Collector: polling every 30–60 s all day doesn't fit GitHub Actions (Deno cron's 1-min minimum is borderline) →
a small always-on box at home (a second Pi) or a cheap cloud server.

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
- **Raspberry Pi Zero W reference box**, carried **inside a backpack** (on the floor between the feet is best;
  started/stopped and time-synced from the phone over Bluetooth) ([HARDWARE.md](HARDWARE.md) has the
  shopping list and carrying notes): kHz vibration
  (wheel flats, rail corrugation — the bearing-fault idea applied to a train), floor-mounted ISO comfort,
  CO₂ (crowding), PM2.5 (metro dust), high-resolution pressure. Rides with box + phone together give a
  per-position correction for every phone recording.
- **Gyroscope path tracing:** turn rate × speed → the track's shape between stations, with gyro drift
  removed by forcing each path to end at the next station (same trick as the speed bias). Gives curve radius
  (speed ÷ turn rate) and, with the measured sideways acceleration, how much of the curve force the track's
  banking cancels. Needs the phone fixed relative to the car (bag on the floor).

### Crowding from Bluetooth device counts (passive, anonymous)

Count the Bluetooth signals that phones, watches and earbuds broadcast anyway — an established crowd-sensing
method. **Rules, not optional:**
- **Listen only.** Never connect to, pair with, or send anything to another device.
- **Never store addresses.** Hash each address in memory with a key that changes every ride; save only the
  number of unique devices per minute. Nobody can be followed across rides.
- **Ethics:** university ethics-committee approval before publishing; mention it to Metro İstanbul. A
  Bluetooth address is personal data under KVKK.
- Skip Wi-Fi probe sniffing (more intrusive; the Zero W needs patched firmware for it).

**What the count is:** a relative crowding signal, not a headcount — phones change their Bluetooth address
every ~10–15 min (count per minute), one person can carry 3 devices or 0, signals cross car walls. Keep only
strong signals (≈ own car) and count only while the train is moving (keeps the platform crowd out).

**Crowding from four signals, cross-checked:** Bluetooth count (instant) · CO₂ (slow, real breathing) ·
dwell time (crowds slow boarding) · manual 1–5 rating in the app (ground truth).

### Underground mobile-coverage map (per stretch, per operator)

Existing coverage maps (OpenSignal, nPerf, CellMapper) place readings with GPS — which doesn't work
underground, so metro tunnels are blank or wrong on them. This project knows where the train is without GPS
(stop detection + speed between stations), so it can map coverage where nobody else can.

- **Native app logs, ~1/s (Android limits some fields to every few s):** signal strength (RSRP), quality
  (RSRQ / SINR), network type (5G/4G/3G/none), serving cell, and whether mobile data works. Own data only.
- **Optional data check** (a setting — costs a little data): a tiny request every ~10 s → works / latency.
- **Analysis:** each reading placed on the track (stretch + distance along it from the speed profile).
- **Output:** per-operator map, each stretch coloured strong → dead, gaps listed
  ("M4 Ünalan → Acıbadem: Turkcell drops for ~400 m").
- **Coverage of all three operators** (Turkcell, Vodafone, Türk Telekom) comes from friends' SIMs; a dual-SIM
  phone may log two at once (check that it reports both).
- **Limits:** phone models report a few dB apart (calibrate per phone, like T4); readings every few s =
  every ~20–50 m at metro speeds — fine for gaps; good signal ≠ working data (hence the optional check).
- **Most shareable output of the project:** useful to every rider, no privacy issues, own data.

### What else to sense — respectfully

Rule: **sense the environment and the infrastructure, never people's content or identities.**

**In scope**
| Signal | Source | Gives |
|---|---|---|
| Own phone's cellular signal: strength, serving cell, handovers | native app (own data) | coverage map per stretch; handovers happen at fixed tunnel-antenna positions → a second way to identify stations |
| Wi-Fi access points — fixed infrastructure only | app / Pi | station fingerprint for positioning; personal-hotspot names are personal data → count only, never store names |
| Infrastructure Bluetooth beacons (if Istanbul's stations have any — unverified) | app / Pi | exact station positions |
| Door chimes / announcement tones, detected on-device | microphone | exact door open/close times → precise dwell; store event times only, never audio |
| Loudness + coarse frequency bands | microphone, on-device | noise comfort; wheel squeal on curves (pairs with gyroscope curves); coarse bands can't be turned back into speech |
| Magnetic field | magnetometer | traction-motor signature; with the motion data, possibly a rough energy-use proxy (hypothesis) |
| Temperature, humidity, CO₂, PM, VOC (SGP41) | Pi box | air quality; how well the car's air conditioning copes with crowds |
| GPS | phone | true speed on above-ground stretches to validate the accelerometer |

**Out of scope — never**
- Wi-Fi probe requests from people's phones (identifiers; more intrusive than BLE counting)
- Any network traffic content, even unencrypted
- Istanbulkart / NFC — reading anyone's card
- Audio recordings, cameras, photos of people
- The train's control radio (CBTC) and staff radio — safety-critical, and intercepting them is illegal in Turkey

**First to add:** cellular handovers (free, own data, a second underground positioning method) and door-chime
detection (precise dwell times, zero audio stored).

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
- **Crowding rating in the app:** 1–5 "how full is the car", tapped a few times per ride — ground truth for the
  Bluetooth / CO₂ / dwell-time crowding signals.

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
