# Working notes

Things found during the 2026-10-06 audit that are not fixed in code, so they don't get lost.

## Website: open design items (judgment calls, not bugs)

- **Departure board** (`board.html`): even at 1440 px the last column ("Based on") is cut off; on a phone only
  time, flight number and part of the destination show without sideways swiping.
- **THY globe on phones** (`thy-globe.html`): the info panel covers the lower half of the globe; the search
  placeholder is truncated ("e.g. 195").
- **Piano on phones** (`piano.html`): the instrument sits below all six story cards — a long scroll to reach it.
- **Homepage hero**: the large "Universal bearing RUL" tile is an empty purple block; looks unfinished at desktop size.
- Small polish: on phones some eyebrow labels wrap with a leading "·"; the Concorde intro paragraph sits
  outside its card with a narrower margin; markers 1 and 11 overlap near Paris on the notable-flights globe.
- Not checked in depth: `board.html`, `notable-flights.html` and other data-heavy pages' rendering logic
  (they render the site's own JSON, low risk).
- Audit leftovers not fixed: CDN scripts have no SRI `integrity` hashes; the Deno proxy allows any origin
  (`Access-Control-Allow-Origin: *`) and has no rate limit; concurrent cache-expiry requests all hit OpenSky;
  repo grows with every data commit (~22 MB packed); README doesn't list `reducer.html` / `piano.html`.

Screenshots were taken with `tools/visual-check.mjs`.

## IST delay pipeline (ist-delay-dataset) — checked 2026-10-06, healthy

- Lives in the private `ist-delay-dataset` repo; pushes `summary.json` / `board.json` here as `github-actions[bot]`.
- `collect.yml` has no GitHub schedule on purpose (removed 2026-07-20, commit `9174919`): the Deno proxy's
  `Deno.cron` dispatches it at 18:45 UTC daily. All runs 2026-09-27 → 10-05 succeeded.
- Low same-day numbers (e.g. 2026-10-05: 9 flights, 0.6% match) are OpenSky's 6–9 h consolidation lag;
  each day is re-finalised over the next two evenings.
- **Single point of failure:** if the GitHub token stored in Deno Deploy expires, collection stops silently.
  Idea: a GitHub-cron backstop that only runs if no collection happened by ~20:00 UTC.
- `actions/checkout@v4` and `actions/setup-python@v5` warn about deprecated Node 20 — bump when convenient.
- Paid aviationstack key (planned for early October) not active yet as of 2026-10-05.

## WhereisMyRide

Moved (with its full history) to its own repo: **ahmethamzamulayim-png/WhereisMyRide**. This branch now holds
only the website fixes and these notes — safe to merge.
