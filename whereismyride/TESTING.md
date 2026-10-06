# Field test plan

Everything here has only been tested on synthetic rides so far. Each test below answers one question about
real rides. Run them roughly in order: the early ones decide whether the later ones can be trusted.

**Always write down for each test ride:** date, line, boarding/alighting station, phone model, phone position,
car number, and the clock time at 2–3 stations (ground truth). The app records most of it; the station times
go in its *Note* field (e.g. `Ünalan 08:14:05, Acıbadem 08:16:40`).

Two phones on the same ride is the most powerful setup in this plan: same train, same track, same moment —
only the thing being tested differs. Recruit one friend for the T2–T4 rides.

---

## A. Does the recording work at all?

### T0 — App on a real phone
- Install from the GitHub Pages link (Chrome → ⋮ → *Add to Home screen*).
- Check: samples/s shown while recording (expect 50–200), screen stays on, *Share* produces a `.zip`,
  `python -m analysis.ride <zip>` runs on it.
- **Pass:** all of the above on your phone. Note the samples/s — below ~40 is too slow for the vibration numbers.
- If the sensor never starts: note phone model + Chrome version; some phones need the page opened over HTTPS
  and a tap before sensors flow.

### T1 — Stop detection against ground truth (first 3 rides)
- Phone position: *bag on the floor* if you can, else *front pocket*. Note station times by hand.
- **Pass:** number of detected runs = number of stations travelled, and every detected departure within
  ±3 s of the noted time.
- If it fails: send the zip. This is the most important test — everything else stands on it.

### T5 — Screen off / app in background
- On one ride, deliberately lock the screen for ~10 s mid-run.
- **Pass:** the app shows the gap warning and the ride's `sensor_gaps` lists it. (Expected: the browser
  pauses the sensor. This test confirms the app *notices*, not that it survives.)

### T11 — Phone clock accuracy
- Before a ride, compare the phone clock to time.is (or any atomic-clock site). Note the offset.
- **Why:** the timetable comparison is in seconds; a phone 5 s off makes every train look 5 s late.
- **Pass:** offset under 1 s (phones normally sync automatically). If not, record the offset per phone.

### T12 — Battery
- Note battery % at start and end of a 30-min ride with the screen on.
- **Pass:** acceptable to you and friends (guess: 5–10%). If much worse, dimming the screen during
  recording is the first fix.

---

## B. Does phone placement change the answer?

### T2 — Position vs. position (two phones, same ride)
- Phone A *bag on floor*, phone B *front pocket*. Repeat with B in *hand* and B in *bag worn on body*.
- **Compare:** stop times, traction/braking peaks, jerk, vibration.
- **Expected:** stop times and traction/braking/jerk agree closely in every position except hand;
  vibration is lower in pocket/worn bag than on the floor.
- **Decides:** which positions friends may use, and whether traction/braking/jerk are placement-independent
  as claimed in `analysis/comfort.py`.

### T3 — Same position, two phones (noise floor)
- Both phones in the same bag on the floor.
- **Compare:** every number. The difference between them is the measurement noise.
- **Decides:** the smallest difference between two trains or two stretches that means anything.

### T4 — Phone model vs. phone model
- Two different phone models, same position, same ride.
- **Decides:** whether rides from different friends' phones can be pooled, or need a per-phone correction.

---

## C. Are the numbers right?

### T6 — Timetable API vs. the platform
- Run `python timetable/fetch_timetable.py M4` (from a laptop — needs internet access to `api.ibb.gov.tr`).
- On the platform, photograph the departure screen for 3–4 departures; compare with the fetched times.
- **Pass:** they match. If the API is a generic template and the screens differ, the timetable comparison
  must use something else.
- Also: run it on a Saturday and a Sunday — are weekend timetables different?

### T7 — Distances (OpenStreetMap)
- Run `python network/build_network.py M4 --osm`; re-analyse the T1 rides.
- **Pass:** `dist chk` near 100% on most runs. Consistently ~94% → still using straight-line distances.
  Random scatter → speed integration or axis problem; send the zips.

### T8 — Comfort sanity
- On one ride, note in the Note field any moment that *felt* bad (hard brake, lurch at stop, rough stretch).
- **Pass:** those moments show up as the high jerk / braking / vibration values in the report.

### T9 — Repeatability over days (before any "this stretch is getting worse" claim)
- Same stretch, same position, ~10 rides over 2 weeks.
- **Compute:** spread (standard deviation) of vibration for that stretch.
- **Decides:** how much a stretch must change before it's a real change, not day-to-day scatter, and how
  many rides that takes to see.

---

## F. Reference box (once the parts arrive)

### T13 — Box vs. bench
- Box still on a table for 10 min: noise floor of every sensor. Then tap it: sync spike is sharp and found.
- **Pass:** no dropped samples at the chosen IMU rate (check timestamps), CO₂ and PM readings settle.

### T14 — Box vs. phone, and backpack on the floor vs. worn (same ride)
- Backpack with the box on the floor between your feet, phone in each position in turn (one per ride).
  Then repeat with the backpack worn on your back.
- Also: shake-test at home first - does anything rattle inside the bag? (Rattle = fake vibration.)
- **Compare:** stop times, braking, jerk, vibration spectra.
- **Decides:** the per-position correction for phone recordings, and whether box and phone agree where they
  should (stops, braking).

### T15 — Wheel flats / corrugation
- Several rides, same stretch. Vibration spectrum vs. speed.
- **Look for:** a peak moving with speed at speed ÷ wheel circumference (wheel flat), or a fixed-wavelength
  tone (corrugation). Note car numbers — a flat belongs to a train, corrugation to the track.

### T16 — CO₂ vs. crowding
- Note how full the car is (1–5) at a few points per ride. Sensors sit in the backpack's outer mesh pocket:
  first check at home that CO₂ there follows the room (breathe near it, open a window), not your back.
- **Pass/decides:** whether CO₂ follows crowding closely enough to use as a crowding measure.

### T18 — Bluetooth count vs. crowding
- At home first: confirm the log contains only per-minute counts — **no addresses, hashed or not**.
- Rides: Bluetooth count per minute (strong signals only, while moving) next to the 1–5 rating and CO₂.
- **Decides:** whether the count follows crowding; which signal-strength cut-off best matches "own car";
  how much the count jumps when phones change their addresses.

### T19 — Cellular handovers as position markers
- Log serving cell + signal strength (native app) on ~10 rides of the same stretch.
- **Decides:** do handovers happen at the same place every ride (→ usable as position markers), and does it
  depend on the operator (Turkcell / Vodafone / Türk Telekom)?

### T21 — Coverage map repeatability
- Same stretch, ~5 rides, same phone and SIM. Then a friend's phone on another operator, same ride.
- **Decides:** do the gaps sit at the same places every ride (→ worth mapping), how far apart two phone
  models read on the same operator (calibration), and whether dual-SIM logging reports both operators.

### T20 — Door-chime detection
- On-device detector; log event times only. Check at home that no audio is written anywhere.
- **Pass:** detected door open/close times match noted times within ~1 s at a few stations.

### T22 — Rainflow / fatigue repeatability
- Same stretch, same position, ~10 rides: relative damage per km for that stretch.
- **Decides:** how stable the number is ride to ride - only then compare lines or buses.

### T23 — Bus road roughness
- Phone (or box) on the bus floor/seat, GPS on, ~5 rides of the same route.
- **Pass:** rough patches (and known potholes) show up in the same places every ride; ISO 8608 class per
  stretch is stable.

### T17 — Gyroscope path
- Rides with the phone/box fixed; trace each stretch, compare with the OSM track.
- **Decides:** how close the traced path gets, and how many rides it takes.

## D. Unusual rides (collect as they happen, don't stage)

| Situation | What to check |
|---|---|
| Train held in a tunnel | an extra run is detected → the "run count doesn't match" warning fires, stations unlabelled (correct behaviour) |
| Very long dwell (crowding, doors re-opening) | dwell time measured, no false run |
| Ride starting at a terminus (Kadıköy, Sabiha Gökçen) | turnaround/wait before departure doesn't count as a run |
| Line disruption / short working | note it; compare against `GetServiceStatuses` later |
| Transfer to another line mid-trip | one recording per line - stop and start again |

---

## E. Before friends join (pilot)

- [ ] Consent text in the app: what is recorded, what isn't (no GPS, no account), how to delete, who sees it.
      KVKK applies once other people's rides are stored.
- [ ] A short "how to record" card (3 lines: on board → start, phone stays put, off → stop + share).
- [ ] Decide where shared zips go (one shared folder is enough for a pilot).
- [ ] Pilot: 3–5 friends, 2 weeks. Ask afterwards: what was annoying, what would make them keep using it.

---

## Results log

| Test | Date | Phones | Result | Notes |
|---|---|---|---|---|
| T0 | | | | |
| T1 | | | | |
| T2 | | | | |
| T3 | | | | |
| T4 | | | | |
| T5 | | | | |
| T6 | | | | |
| T7 | | | | |
| T8 | | | | |
| T9 | | | | |
| T11 | | | | |
| T12 | | | | |
| T13 | | | | |
| T14 | | | | |
| T15 | | | | |
| T16 | | | | |
| T17 | | | | |
| T18 | | | | |
| T19 | | | | |
| T20 | | | | |
| T21 | | | | |
| T22 | | | | |
| T23 | | | | |
