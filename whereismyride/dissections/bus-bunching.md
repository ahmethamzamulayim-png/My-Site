# Bus bunching — why do buses come in pairs?

## How it works
A classic unstable system. If a bus runs a little late, more passengers have gathered at each stop, so it
spends longer boarding and falls further behind. The bus behind finds fewer passengers, spends less time at
stops and catches up. Small gaps grow until the two run together - and riders see "nothing for 20 min, then
two at once". Positive feedback: the error feeds itself.

## Measure it
From `bus.collect` logs on lines 17 and 2: the gap between consecutive buses at each stop along the route.
- Does the spread of gaps grow from the first stop to the last? (Bunching = it grows.)
- How often do two buses arrive within 2 min of each other at Kazasker / Ayşekadın?
- Is it worse at peak (more passengers → stronger feedback)?

## What limits it
To find out: is it boarding time (passenger load), traffic, or departure irregularity at the terminus?
Compare gap growth on stretches with many vs few stops, and peak vs off-peak.

## How could it be better
Known remedies to test on my own data by simulation:
- **holding**: hold an early bus at a control stop until the gap behind it is restored
- **headway-based dispatching** at the terminus instead of fixed departure times
- **stop skipping / boarding speed** (all-door boarding) to weaken the feedback

## Open questions
- Does İETT already do any holding? (Look for buses waiting at timing points in the logs.)
