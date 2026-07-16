// Cloudflare Worker — OpenSky proxy for thy-globe.html
//
// Deploy (one time, ~3 min):
//   1. dash.cloudflare.com → Workers & Pages → Create Worker → paste this code.
//   2. Worker → Settings → Variables and Secrets → add two SECRETS:
//        OPENSKY_CLIENT_ID     (from your OpenSky account → API client)
//        OPENSKY_CLIENT_SECRET
//   3. Deploy. Copy the *.workers.dev URL into API_BASE in thy-globe.html.
//
// Responds to GET /api/states with OpenSky /states/all?extended=1 filtered to
// THY callsigns. All visitors share one cached response (20 s), so OpenSky
// sees a fixed ~4.3k requests/day no matter how many people are watching.

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all?extended=1";
const CACHE_MS = 20000;

// ponytail: per-isolate memory cache — separate datacenters each keep their
// own copy. Fine at portfolio traffic; switch to caches.default if it grows.
let token = { value: null, exp: 0 };
let cached = { body: null, exp: 0 };

async function getToken(env) {
  if (Date.now() < token.exp) return token.value;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error("OpenSky auth failed: " + r.status);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return token.value;
}

export default {
  async fetch(request, env) {
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };
    if (Date.now() < cached.exp) return new Response(cached.body, { headers });
    try {
      const t = await getToken(env);
      const r = await fetch(STATES_URL, { headers: { Authorization: "Bearer " + t } });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: "OpenSky " + r.status }), { status: r.status, headers });
      }
      const j = await r.json();
      const states = (j.states || []).filter(s => s[1] && s[1].trim().startsWith("THY"));
      const body = JSON.stringify({ time: j.time, states });
      cached = { body, exp: Date.now() + CACHE_MS };
      return new Response(body, { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
    }
  },
};
