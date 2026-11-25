# Mechanical Engineering Portfolio

Static portfolio for GitHub Pages, live at [ahmethmzamlym.engineer](https://ahmethmzamlym.engineer). No build step at deploy time — plain HTML/CSS/JS. Bilingual: every page exists twice, English at its bare URL and Turkish under `/tr/` (e.g. `/bearing` and `/tr/bearing`), each real static HTML with its own `<html lang>` and reciprocal `hreflang` tags — not a client-side toggle.

## Pages

| Page | What it is |
|---|---|
| `index.html` | The portfolio: about, projects, skills, timeline, contact form |
| `about.html` | Background, SolidWorks CSWA badge, skills, and education timeline |
| `reducer.html` | Parametric CadQuery ASME B16.9 pipe reducer generator — 128 validated B-rep STEP solids with an interactive 3D configurator |
| `thy-globe.html` | Every airborne Turkish Airlines flight on a live 3D globe (ADS-B, 15s refresh) — feed offline since late 2026, page kept as a demo |
| `ist-shutdown.html` | Write-up: why the IST pipeline was switched off (Nov 2026), and what it produced |
| `ist-rotar.html` | Archived dashboard for the Istanbul Airport (IST) delay dataset, frozen on 1 May – 12 Sep 2026 |
| `board.html` | Archived IST departure board — last clean window (12 Sep 2026) with outcomes and the full live record |
| `route-delay-globe.html` | IST's riskiest outbound routes, plotted on a 3D globe |
| `wimr.html` | WhereisMyRide hub: what a phone's sensors reveal about a metro train (speed integration, Bernoulli in the tunnel, the motors' magnetic field, why buses come in pairs), with KaTeX maths and a graded prediction table. Data: `metro/wimr.json` (`analysis/hub.py`) and `metro/bus.json` (`analysis/buses.py`, lines anonymised) in the WhereisMyRide repo |
| `metro-tunnel.html` | A 12 km metro tunnel rebuilt in 3D from phone sensors (gyroscope, barometer, accelerometer); three.js view, braking-energy analysis. Data: `metro/tube.json`, built by `analysis/tube.py` in the WhereisMyRide repo — stations anonymised (S1–S9) on purpose |
| `bearing.html` | Bearing failure prediction on NASA's IMS vibration dataset |
| `bearing-universal.html` | Part 2 — does the model generalize across 3 rigs / 36 bearings (IMS, XJTU-SY, FEMTO)? |
| `phase2.html` | Roadmap and findings for an IST delay-prediction model |
| `model.html` | The delay prediction model itself — AUC vs. a lookup-table baseline |
| `three-hubs.html` | IST vs. Heathrow vs. Frankfurt punctuality, same window, same delay definition |
| `concorde.html` | Fan tribute to Concorde — biography timeline + notable-flights globe |
| `notable-flights.html` | The Concorde notable-flights globe, standalone |
| `ist-history.html` | How Istanbul built the world's 8th-busiest airport, with a 2017–2025 satellite timelapse |
| `piano.html` | Interactive 88-key browser piano with sampled audio, falling-note visualizer, Web MIDI input, and built-in `.mid` pieces |
| `404.html` | Branded not-found page (GitHub Pages serves this for any dead link) |

## Live Turkish Airlines flight globe

[ahmethmzamlym.engineer/thy-globe](https://ahmethmzamlym.engineer/thy-globe)

Every airborne Turkish Airlines flight on an interactive 3D globe ([globe.gl](https://github.com/vasturiano/globe.gl)), updated every 15 seconds from live ADS-B data:

- **Flight positions** come from the [OpenSky Network](https://opensky-network.org/) via a tiny Deno Deploy proxy ([thy-globe-proxy-deno.ts](thy-globe-proxy-deno.ts)) that holds the API credentials, filters to THY callsigns, and shares one 20 s cache across all visitors. Deploy notes are in the file header.
- **Aircraft models and routes** come from [adsbdb](https://www.adsbdb.com/) client-side, cached in localStorage.
- Click a plane for its type, registration, and route arc; search filters by flight number.

## IST delay dataset

`ist-rotar.html`, `board.html`, `route-delay-globe.html`, `phase2.html`, `model.html`, and `three-hubs.html` are all built on one dataset: IST flight movements (OpenSky) joined with schedules (aviationstack) and archived METAR weather, collected daily by a companion pipeline from May to October 2026. **The pipeline was switched off on 2026-11-14** (see `ist-shutdown.html`). `board.json` and `summary.json` are now frozen snapshots of the clean period (up to 2026-09-12), regenerated once from the dataset repo — nothing writes to them any more.

## Notes

- **Clean URLs**: GitHub Pages serves `/page` as `page.html` directly (no redirect), so every internal link skips the extension. `sitemap.xml` and `robots.txt` list the canonical extensionless URLs.
- **Bilingual pages**: each page under `/tr/` is a real, independently-editable HTML file, not generated at deploy time. Editing a page's content means updating both the English file and its `/tr/` counterpart by hand — there's no build step or shared dict tying them together.
- **Analytics**: [Umami Cloud](https://umami.is/) on every page — no cookies, privacy-friendly. (Switched from GoatCounter 2026-08-10 after a prolonged outage.)
- **Contact form**: submits via [FormSubmit](https://formsubmit.co/) directly to email, no backend. File attachments post natively into a hidden iframe (FormSubmit's file uploads require a real multipart POST, not their JSON endpoint).
- **View transitions**: pages cross-fade into each other on navigation in Chromium browsers ([`@view-transition`](https://developer.mozilla.org/en-US/docs/Web/CSS/@view-transition) in `styles.css`); falls back to a normal navigation elsewhere.

## Files

| File | What it is |
|---|---|
| `styles.css` / `script.js` | Shared across every page — palette/layout, reveal-on-scroll + contact form JS |
| `i18n.js` | Exposes `t(en, tr)` / `fmt(n)` / `getLang()` for pages that render content at runtime (live data, charts, tooltips), reading the fixed language off `<html lang>` |
| `thy-globe-proxy-deno.ts` | Deno Deploy proxy that feeds the flight globe (see above) |
| `countries-110m.geojson` | Vector world map used by the globe pages |
| `board.json` / `summary.json` | Pre-scored IST flight data read by `board.html`, `route-delay-globe.html`, etc. |
| `data-ist-history.json` / `data-ist-satellite.json` | Data behind `ist-history.html`'s timeline and satellite timelapse |
| `metro/` | WhereisMyRide hub & 3D metro tunnel data (`wimr.json`, `tube.json`, `bus.json`), scripts, styles, and Tekir mascot |
| `reducer/` | Pipe reducer configurator script, `manifest.json`, flow visuals, and 128 `.glb` preview models |
| `assets/img/og/` | Per-page social preview images |
| `scripts/audit.py` | Automated static audit (UTF-8 JSON, EN/TR parity, links, OG, CLS dimensions, JS syntax), also run in GitHub Actions (`.github/workflows/audit.yml`) |
| `CNAME` | Custom domain for GitHub Pages |
