# Dissections

One file per system. Same four questions every time — the habit is the point.

```
# <System>
## How it works        - the mechanism, as best I understand it (sources)
## Measure it          - what my data shows (rides, bus logs, box) - numbers, plots
## What limits it      - the binding constraint, and how I know it's that one
## How could it be better - a concrete change, and what the data says it would gain
## Open questions
```

| System | Question | Data | Status |
|---|---|---|---|
| [Bus bunching](bus-bunching.md) | Why do buses come in pairs? | bus collector: headways | open |
| Kiosk arrival prediction | How does it work, why is it wrong? | `bus.score` vs kiosk-style baseline | open |
| Metro headway | What sets the minimum gap between M4 trains? | rides: dwell, run times, terminus turnback | open |
| Train motion profile | Why does it accelerate/brake exactly like that? | rides: traction, braking, jerk vs comfort limits | open |
| Station dwell | Where do the seconds at a station go? | door chimes, crowding signals, dwell | open |
| Regenerative braking | How much energy could braking give back? | rides: braking × speed → kinetic energy; magnetometer | open |
| Track & wheel wear | Where is the track / are the wheels wearing? | box: spectra, wheel flats, corrugation, trends | open |
| Road & bus wear | Which routes wear buses fastest? | bus rides: ISO 8608, rainflow damage per km | open |
| Tunnel coverage | Why are there signal gaps underground? | coverage map: handovers, gaps | open |
