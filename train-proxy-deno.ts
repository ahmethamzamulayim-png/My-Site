// Deno Deploy — TfL + MTA proxy for trains.html (live train map).
//
// Deploy (one time, ~3 min):
//   1. https://dash.deno.com → sign in with GitHub → New Playground.
//   2. Paste this file, click Save & Deploy.
//   3. Project → Settings → Environment Variables: add TFL_APP_KEY
//      (MTA needs no key — see README).
//   4. Copy the *.deno.dev URL into API_BASE in trains.html.
//
// GET /api/tfl/:lineId   -> TfL /Line/{id}/Arrivals, app_key injected server-side
// GET /api/mta/:group    -> decoded GTFS-RT feed as JSON, group is one of:
//                           ace bdfm g jz nqrw l si numbered
//
// gtfs-realtime-bindings is imported from esm.sh rather than npm: — the
// npm package lists protobufjs-cli (a full lint/docs toolchain) as a runtime
// dependency by mistake; the actual bindings file only needs
// protobufjs/minimal, and esm.sh resolves that correctly instead of pulling
// the whole declared graph.
import gtfsRt from "https://esm.sh/gtfs-realtime-bindings@2.2.0";
const { transit_realtime } = gtfsRt;

const TFL_BASE = "https://api.tfl.gov.uk";
const MTA_FEEDS: Record<string, string> = {
  ace: "nyct%2Fgtfs-ace",
  bdfm: "nyct%2Fgtfs-bdfm",
  g: "nyct%2Fgtfs-g",
  jz: "nyct%2Fgtfs-jz",
  nqrw: "nyct%2Fgtfs-nqrw",
  l: "nyct%2Fgtfs-l",
  si: "nyct%2Fgtfs-si",
  numbered: "nyct%2Fgtfs",
};

const CACHE_MS = 15000;
const cache = new Map<string, { body: string; exp: number }>();
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

async function cached(key: string, fn: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.body;
  const body = await fn();
  cache.set(key, { body, exp: Date.now() + CACHE_MS });
  return body;
}

async function tflArrivals(lineId: string): Promise<string> {
  const key = Deno.env.get("TFL_APP_KEY") ?? "";
  const r = await fetch(`${TFL_BASE}/Line/${lineId}/Arrivals?app_key=${key}`);
  if (!r.ok) throw new Error("TfL " + r.status);
  return await r.text();
}

async function mtaFeed(group: string): Promise<string> {
  const path = MTA_FEEDS[group];
  if (!path) throw new Error("unknown group " + group);
  const r = await fetch(`https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/${path}`);
  if (!r.ok) throw new Error("MTA " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const feed = transit_realtime.FeedMessage.decode(buf);
  return JSON.stringify(feed.toJSON());
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","tfl","victoria"] | ["api","mta","ace"]

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });
  }
  try {
    if (parts[0] === "api" && parts[1] === "tfl" && parts[2]) {
      const body = await cached("tfl:" + parts[2], () => tflArrivals(parts[2]));
      return new Response(body, { headers: CORS });
    }
    if (parts[0] === "api" && parts[1] === "mta" && parts[2]) {
      const body = await cached("mta:" + parts[2], () => mtaFeed(parts[2]));
      return new Response(body, { headers: CORS });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 502, headers: CORS });
  }
});
