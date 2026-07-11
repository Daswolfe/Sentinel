import { CONFIG } from './config.js';

// Caches a bearer token and refreshes it ~30s before expiry.
let token = null;
let expiresAt = 0;

async function getToken() {
  if (!CONFIG.opensky.id || !CONFIG.opensky.secret) return null;
  if (token && Date.now() < expiresAt) return token;

  const res = await fetch(CONFIG.opensky.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CONFIG.opensky.id,
      client_secret: CONFIG.opensky.secret,
    }),
  });
  if (!res.ok) throw new Error(`OpenSky token ${res.status}`);
  const j = await res.json();
  token = j.access_token;
  expiresAt = Date.now() + (Number(j.expires_in || 1800) - 30) * 1000;
  return token;
}

// Proxies /states/all, passing through an optional bounding box query string.
// Returns { status, body } so the http layer can relay headers/status cleanly.
export async function fetchStates(search) {
  const url = CONFIG.opensky.statesUrl + (search || '');
  const headers = {};
  const t = await getToken().catch(() => null);
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(url, { headers });
  const body = await res.text();
  return {
    status: res.status,
    retryAfter: res.headers.get('X-Rate-Limit-Retry-After-Seconds'),
    remaining: res.headers.get('X-Rate-Limit-Remaining'),
    body,
  };
}

// Full flight path since takeoff (OpenSky's experimental tracks endpoint).
// Returns waypoints [[time, lat, lon, baroAltM, trueTrack, onGround], …].
export async function fetchTrack(icao24) {
  const url = `https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`;
  const headers = {};
  const t = await getToken().catch(() => null);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.text() };
}

export const openskyAuthed = () => Boolean(CONFIG.opensky.id && CONFIG.opensky.secret);
