// Deno Deploy — OpenSky proxy for thy-globe.html (alternative to the
// Cloudflare Worker, for when OpenSky won't talk to Cloudflare egress IPs).
//
// Deploy (one time, ~3 min):
//   1. https://dash.deno.com → sign in with GitHub → New Playground.
//   2. Paste this file, click Save & Deploy.
//   3. Project → Settings → Environment Variables: add
//        OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET
//   4. Copy the *.deno.dev URL into API_BASE in thy-globe.html.
//
// Same behavior as the Worker: GET /api/states → OpenSky /states/all
// ?extended=1, filtered to THY callsigns, one shared 20 s cache.

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all?extended=1";
const CACHE_MS = 20000;

let token = { value: "", exp: 0 };
let cached = { body: "", exp: 0 };

async function getToken(): Promise<string> {
  if (Date.now() < token.exp) return token.value;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: Deno.env.get("OPENSKY_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("OPENSKY_CLIENT_SECRET") ?? "",
    }),
  });
  if (!r.ok) throw new Error("OpenSky auth failed: " + r.status);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return token.value;
}

Deno.serve(async (_req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };
  if (Date.now() < cached.exp) return new Response(cached.body, { headers });
  try {
    const t = await getToken();
    const r = await fetch(STATES_URL, { headers: { Authorization: "Bearer " + t } });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "OpenSky " + r.status }), { status: r.status, headers });
    }
    const j = await r.json();
    const states = (j.states || []).filter((s: unknown[]) =>
      typeof s[1] === "string" && (s[1] as string).trim().startsWith("THY")
    );
    const body = JSON.stringify({ time: j.time, states });
    cached = { body, exp: Date.now() + CACHE_MS };
    return new Response(body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 502, headers });
  }
});
