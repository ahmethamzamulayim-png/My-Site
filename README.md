# Mechanical Engineering Portfolio

Static portfolio for GitHub Pages, live at [ahmethmzamlym.engineer](https://ahmethmzamlym.engineer). No build step — plain HTML/CSS/JS.

## Live Turkish Airlines flight globe

[ahmethmzamlym.engineer/thy-globe.html](https://ahmethmzamlym.engineer/thy-globe.html)

Every airborne Turkish Airlines flight on an interactive 3D globe ([globe.gl](https://github.com/vasturiano/globe.gl)), updated every 15 seconds from live ADS-B data:

- **Flight positions** come from the [OpenSky Network](https://opensky-network.org/) via a tiny serverless proxy that holds the API credentials, filters to THY callsigns, and shares one 20 s cache across all visitors — [thy-globe-proxy-deno.ts](thy-globe-proxy-deno.ts) (Deno Deploy, currently live) or [thy-globe-worker.js](thy-globe-worker.js) (Cloudflare Worker fallback). Deploy notes are in each file's header.
- **Aircraft models and routes** come from [adsbdb](https://www.adsbdb.com/) client-side, cached in localStorage.
- Click a plane for its type, registration, and route arc; search filters by flight number.

## Files

| File | What it is |
|---|---|
| `index.html` / `styles.css` / `script.js` | The portfolio page |
| `thy-globe.html` | The flight globe (self-contained page, shares `styles.css`) |
| `countries-110m.geojson` | Vector world map for the globe |
| `CNAME` | Custom domain for GitHub Pages |
