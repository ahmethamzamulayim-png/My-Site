# WhereisMyRide

Where is my M4 train right now, and how far can the official timetable be trusted to answer that?

No public source gives live Istanbul metro positions. Metro İstanbul publishes a minute-precision
timetable; nobody publishes how closely the trains follow it. This project measures that with a
phone's sensors on real rides, then builds a scheduled-position map labelled with the measured accuracy.

Full plan and reasoning: [PLAN.md](PLAN.md).

## Why this exists

I'm a mechanical engineering student. I like to take apart every system I meet — how it works, what limits
it, how it could be better. Istanbul's transport is the system I use every day, so this project is my lab for
dissecting it. The useful tools ("when do I leave?", next bus, coverage map) are by-products; the point is
understanding.

Every subsystem gets the same treatment, logged in [`dissections/`](dissections/):
**how it works → measure it → what limits it → how could it be better** (with the data to estimate the gain).

## Status

| | |
|---|---|
| Recorder app (`app/`) | working in a browser test; not yet tried on a real phone |
| Ride analysis (`analysis/`) | working on synthetic rides and on the app's own export; first real ride pending |
| Network (`network/`) | all 18 lines, 245 stations from the official API; distances **straight-line, provisional** (~6% short on M4) |
| Timetable fetcher (`timetable/`) | written, not yet run - the API wasn't reachable from where it was written |
| Ride comfort (`analysis/comfort.py`, `summary.py`) | ISO 2631-1 weighting verified; by line / vehicle / stretch summaries |
| Map | not started (Phase 6) |

## The recorder app

`app/` is an installable web app (open it in Chrome on Android → ⋮ → *Add to Home screen*). Pick the line,
where you board and where you get off, press start, ride, press stop. It records the motion sensor, notes the
exact start time itself, and shares each ride as a `.zip` that `analysis.ride` reads directly:

```
python -m analysis.ride 2026-10-07_0812_M4_Goztepe-Kadikoy.zip
```

It needs HTTPS to read the sensor, so it has to be hosted (GitHub Pages works). Rides stay on the phone
until shared; no GPS, no account, no server.

**Limit:** a browser stops the motion sensor when the screen turns off. The app keeps the screen awake and
flags any gap it sees, but a ride only works with the screen on. A native Android app (foreground service)
would remove that limit - worth building once the web version has proven the idea with friends.

## Recording a ride with phyphox instead

1. Install **phyphox** (free). Use **Acceleration (without g)**; if you build a custom experiment, add
   Magnetometer and Pressure too.
2. Start recording **once you're on the train, before the doors close**, and stop it after the train has
   stopped at your station, before you walk off. Walking on the platform looks like a train moving.
3. Keep the phone in **one position** the whole ride (flat on your lap, or in a bag on your knees).
4. Note the **exact clock time** you pressed start (to the second) - everything lines up with the
   timetable through this.
5. Export as CSV, put it in `rides/YYYY-MM-DD_HHMM_<direction>/` with a `ride.yaml` copied from
   [`rides/_example/ride.yaml`](rides/_example/ride.yaml).

Raw rides are git-ignored on purpose: a folder of them is a timestamped record of where you are every
weekday. Only aggregate results get published.

## Running it

```
pip install -r requirements.txt

python network/build_network.py M4 --osm      # once: real along-track distances (needs internet)
python timetable/fetch_timetable.py M4        # daily: today's timetable
python -m analysis.ride rides/2026-10-07_0812_kadikoy
python tests/test_ride.py && python tests/test_robustness.py
node tests/app_e2e.mjs ...                    # browser test of the app, see the file header
```

`analysis.ride` prints, per run between stations: departure time, run time, dwell time, average and peak
speed, a distance check, and how far each departure was from the timetable. `--json` for machine-readable
output.

## Ride comfort

Every run between two stations also gets comfort numbers (`analysis/comfort.py`):

| number | unit | what a passenger feels |
|---|---|---|
| traction / braking peak | m/s² | how hard the train pushes you back / forward |
| jerk at start / stop | m/s³ | how *abruptly* that push changes - the lurch |
| weighted vibration `aw` | m/s² | how rough the ride is, ISO 2631-1 weighted (vertical Wk, horizontal Wd) |

The ISO weighting filters are checked against the standard's tabulated factors (`tests/test_comfort.py`).

`python -m analysis.summary rides/` compares many rides: **by line**, **by vehicle** (the car number noted in
the app - different fleets on the same track) and **by stretch of track** (rough every time, whichever train
runs it → a maintenance signal; getting rougher over weeks → a trend).

**Limits, plainly:** most metro riders stand, so the app assumes standing. Traction, braking and jerk are slow
movements that a pocket or bag follows faithfully - they hold up wherever the phone is (except in a hand). The
vibration number is softened by the body: ISO 2631-1 measures at the floor under a standing passenger's feet, so
the closest a phone gets is a bag on the floor between your feet (`bag-on-floor`). Vibration figures are
*comparison* numbers - valid between rides with the same `phone_position` - not ISO compliance figures. Jerk is measured after 1 Hz smoothing (otherwise it's just rail vibration differentiated),
so it's comparable between rides, not a test against a design limit.

## How it works, briefly

- **Stops** are found from how much the phone shakes (rolling standard deviation of acceleration), then
  each run's edges are pinned to the train's own push when it pulls away and brakes. No integration, so no
  drift. Tested to within 1 s on synthetic rides, including a phone bumped during a stop and a sensor bias
  10x larger than a decent phone's.
- **Speed** is integrated only between two stops. Speed is zero at both ends, so the sensor's constant bias
  can be solved for and removed. Integrated over a whole ride it would be meaningless.
- **Distance check:** integrated distance ÷ track distance. Near 100% means the speed profile can be
  trusted; far off means the phone moved, or the run was mis-detected.
- **Timetable comparison** is limited by the timetable itself: `HH:MM` only, so anything within ±30 s
  counts as on time.

## Data sources

- Stations and timetables: Metro İstanbul web services, İBB Açık Veri Portalı (CC BY 4.0).
- Track geometry: © OpenStreetMap contributors (ODbL).
- Request formats verified against [mdemirer/sonraki-tren](https://github.com/mdemirer/sonraki-tren).
