import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { CONFIG } from './config.js';
import { AisRelay } from './ais.js';
import { fetchStates, fetchTrack, openskyAuthed } from './opensky.js';
import { getJamming } from './gpsjam.js';
import { getConflict } from './gdelt.js';
import { Analytics, correlate } from './analytics.js';
import { getBikeshare } from './bikeshare.js';

// Desktop-shell watchdog: when spawned by the Tauri shell (ARGUS_PARENT_PID),
// exit if the parent dies — covers force-kills where the shell's own exit
// hook (which kills us gracefully) never gets to run.
const parentPid = Number(process.env.ARGUS_PARENT_PID);
if (parentPid) {
  setInterval(() => {
    try { process.kill(parentPid, 0); } catch { process.exit(0); }
  }, 5000).unref();
}

const relay = new AisRelay();
let outagesCache = { t: 0, data: null }; // Cloudflare Radar outages (15-min cache)
let maritimeCache = null; // preprocessed maritime-boundary index (static)
const firmsCache = new Map(); // "source/box/days" -> { t, body } — last GOOD FIRMS pull

// Google 3D Tiles free-tier meter — persisted so restarts can't reset it.
// Counts ROOT tileset requests (the billable unit); resets each calendar month.
const TILES_USAGE_FILE = new URL('./data/google-tiles-usage.json', import.meta.url);
let tilesUsage = null;
async function tilesUsageNow() {
  if (!tilesUsage) {
    try { tilesUsage = JSON.parse(await readFile(TILES_USAGE_FILE, 'utf8')); }
    catch { tilesUsage = { month: '', count: 0 }; }
  }
  const month = new Date().toISOString().slice(0, 7);
  if (tilesUsage.month !== month) tilesUsage = { month, count: 0 };
  return tilesUsage;
}
let aisStatus = relay.enabled ? 'connecting' : 'disabled';
relay.on('status', (s) => (aisStatus = s));

// Tier-3 analytics: STS-transfer scan over the live vessel picture.
const analytics = new Analytics(relay);

// Optional persistence (better-sqlite3). Loaded dynamically so the server
// still runs if the native module isn't installed/built on this machine.
let db = null;
try {
  db = await import('./db.js');
} catch (e) {
  console.log('  • DB    persistence off (better-sqlite3 not available)');
}

// Flips true once the Ollama proxy gets a good response; surfaced in /health
// so the UI can show whether local intel reports are available.
let llmReady = false;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
const json = (res, code, obj) => {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

// ── Per-IP rate limiting (Theme 4.18) ──────────────────────────────────
// Sliding one-minute window per client IP + a cap on concurrent websockets.
// Generous defaults (the UI makes ~20 req/min) — the point is abuse
// protection before any non-localhost exposure, not throttling the operator.
// RATE_LIMIT_PER_MIN=0 disables. Honors X-Forwarded-For only when
// TRUST_PROXY=1 (set it when running behind a reverse proxy).
const RL = {
  max: Number(process.env.RATE_LIMIT_PER_MIN ?? 300),
  wsMax: Number(process.env.WS_MAX_PER_IP ?? 4),
  buckets: new Map(), // ip -> { n, reset }
  wsCount: new Map(), // ip -> live websocket connections
};
const clientIp = (req) =>
  (process.env.TRUST_PROXY === '1' &&
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
  req.socket.remoteAddress ||
  '?';
function rateLimited(ip) {
  if (!RL.max) return false;
  const now = Date.now();
  let b = RL.buckets.get(ip);
  if (!b || now > b.reset) RL.buckets.set(ip, (b = { n: 0, reset: now + 60e3 }));
  return ++b.n > RL.max;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of RL.buckets) if (now > b.reset) RL.buckets.delete(ip);
}, 5 * 60e3).unref();

// API pathnames (post-/api-strip). Kept for the static-serving fallthrough:
// anything else on GET is assumed to be a frontend asset.
const ROUTES = new Set([
  '/health', '/llm', '/ais/snapshot', '/ais/track', '/gpsjam', '/history/alerts',
  '/opensky/track', '/bikeshare', '/firms', '/outages', '/webcams', '/streetview',
  '/milair', '/avwx', '/conflict', '/opensky', '/config', '/tiles-session', '/maritime',
]);

// Minimal static file server for web/dist (Tauri desktop shell / simple LAN
// hosting — nginx still recommended for real deployments). Hashed assets get
// immutable caching; index.html must revalidate so new builds land.
const DIST = new URL('../web/dist/', import.meta.url);
const MIME = {
  html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  ico: 'image/x-icon', woff2: 'font/woff2', webp: 'image/webp',
};
async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file;
  try {
    file = new URL(rel, DIST);
    if (!file.pathname.startsWith(DIST.pathname)) return false; // traversal guard
    const body = await readFile(file);
    const ext = rel.split('.').pop().toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
    return true;
  } catch {
    return false; // missing dist or file — fall through to the API 404
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');

  // Same-origin deployments (Tauri desktop shell, LAN static serving) call the
  // API as /api/<route> — the prefix the vite dev proxy / nginx would strip.
  const isApi = url.pathname.startsWith('/api/');
  if (isApi) url.pathname = url.pathname.slice(4);

  // Static frontend (web/dist) for anything that isn't an API call — this is
  // what the desktop shell window loads, giving it same-origin /api + /ws.
  if (!isApi && req.method === 'GET' && url.pathname !== '/health' && !ROUTES.has(url.pathname)) {
    if (await serveStatic(url.pathname, res)) return;
  }

  if (url.pathname !== '/health' && rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    return json(res, 429, { error: 'rate limited — slow down' });
  }

  // Optional shared-token auth (BACKEND_TOKEN). /health stays open — it's
  // the liveness probe and leaks nothing sensitive.
  if (CONFIG.token && url.pathname !== '/health') {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (bearer !== CONFIG.token && url.searchParams.get('token') !== CONFIG.token)
      return json(res, 401, { error: 'unauthorized' });
  }

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      ais: {
        enabled: relay.enabled,
        mode: relay.mode, // live | record | replay
        status: aisStatus,
        tracked: relay.vessels.size,
        ports: relay.ports.count,
        stats: relay.stats,
      },
      analytics: analytics.stats,
      opensky: { authed: openskyAuthed() },
      db: Boolean(db),
      llm: { model: CONFIG.llm.model, ready: llmReady },
    });
  }

  // Local-LLM (Ollama) intel report, proxied so the browser needs no CORS
  // config. Streams Ollama's NDJSON token feed straight back to the client.
  if (url.pathname === '/llm' && req.method === 'POST') {
    let prompt = '';
    try {
      const body = await new Promise((resolve, reject) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => resolve(b));
        req.on('error', reject);
      });
      prompt = JSON.parse(body || '{}').prompt || '';
    } catch {
      return json(res, 400, { error: 'bad request body' });
    }
    try {
      const upstream = await fetch(CONFIG.llm.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: CONFIG.llm.model, prompt, stream: true }),
      });
      if (!upstream.ok || !upstream.body) {
        return json(res, 502, { error: `Ollama HTTP ${upstream.status}` });
      }
      llmReady = true;
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    } catch (e) {
      llmReady = false;
      return json(res, 502, { error: String(e), hint: 'Ollama not reachable — run `ollama serve`' });
    }
  }

  // Live AIS snapshot for clients that join mid-stream.
  if (url.pathname === '/ais/snapshot') {
    return json(res, 200, relay.snapshot());
  }

  // GPS interference — gpsjam.org daily H3 CSV, decoded, thresholded and
  // clustered into denied zones here (the browser would need an H3 library
  // and a CORS exception otherwise). ?minPct= & ?minAircraft= tune the cut.
  // Client config — the few settings the browser needs from .env. Only the
  // Google 3D-Tiles key crosses the wire (referrer-restricted by design);
  // every other key stays server-side behind its proxy.
  if (url.pathname === '/config') {
    const u = await tilesUsageNow();
    const open = Boolean(CONFIG.googleMapsKey) && u.count < CONFIG.googleTilesCap;
    return json(res, 200, {
      googleMapsKey: open ? CONFIG.googleMapsKey : '',
      tiles3d: { used: u.count, cap: CONFIG.googleTilesCap },
    });
  }

  // Free-tier gate: the client MUST get a ticket here before opening a Google
  // 3D Tiles session (each session = one billable root tileset request).
  // Refuses past the monthly cap so the key can never accrue charges.
  if (url.pathname === '/tiles-session' && req.method === 'POST') {
    const u = await tilesUsageNow();
    if (!CONFIG.googleMapsKey || u.count >= CONFIG.googleTilesCap)
      return json(res, 200, { ok: false, used: u.count, cap: CONFIG.googleTilesCap });
    u.count++;
    try { await writeFile(TILES_USAGE_FILE, JSON.stringify(u)); } catch {}
    return json(res, 200, { ok: true, used: u.count, cap: CONFIG.googleTilesCap });
  }

  // Maritime boundaries — preprocessed Marine Regions index (EEZ delimitation
  // lines incl. disputed, 12 nm territorial-sea + 24 nm contiguous-zone rings).
  // Static after preprocessing; built by server/data/convert-maritime.mjs.
  if (url.pathname === '/maritime') {
    try {
      if (!maritimeCache)
        maritimeCache = await readFile(new URL('./data/maritime.json', import.meta.url));
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' });
      return res.end(maritimeCache);
    } catch {
      return json(res, 404, { error: 'maritime index missing — run server/data/convert-maritime.mjs' });
    }
  }

  if (url.pathname === '/gpsjam') {
    try {
      const minPct = Math.max(2, Number(url.searchParams.get('minPct')) || 10);
      const minAc = Math.max(5, Number(url.searchParams.get('minAircraft')) || 10);
      return json(res, 200, await getJamming(minPct, minAc));
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Breadcrumb track for one vessel — in-memory history, extended by the
  // SQLite archive (which survives restarts) when available.
  if (url.pathname === '/ais/track') {
    const mmsi = Number(url.searchParams.get('mmsi'));
    const mem = relay.vessels.get(mmsi)?.track ?? [];
    let track = mem;
    if (db) {
      try {
        const persisted = db.trackFor(mmsi);
        if (persisted.length > mem.length) track = persisted;
      } catch (_) {}
    }
    return json(res, 200, { mmsi, track });
  }

  // Pattern-of-life: archived maritime alerts filtered by time / kind / bbox.
  // ?sinceH=<hours back>&kind=<kind|all>&bbox=lamin,lomin,lamax,lomax
  if (url.pathname === '/history/alerts') {
    if (!db) return json(res, 200, { alerts: [], kinds: [], note: 'persistence disabled' });
    const sinceH = Math.min(720, Math.max(1, Number(url.searchParams.get('sinceH')) || 24));
    const kind = url.searchParams.get('kind');
    const bboxStr = url.searchParams.get('bbox');
    const bbox = bboxStr ? bboxStr.split(',').map(Number) : null;
    try {
      const alerts = db.queryAlerts({
        sinceMs: Date.now() - sinceH * 3600e3,
        kind: kind && kind !== 'all' ? kind : null,
        bbox: bbox && bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null,
      });
      return json(res, 200, { alerts, kinds: db.alertKinds() });
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Full flight path for one aircraft (OpenSky tracks API, OAuth attached).
  if (url.pathname === '/opensky/track') {
    const icao = (url.searchParams.get('icao24') || '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao)) return json(res, 400, { error: 'bad icao24' });
    try {
      const out = await fetchTrack(icao);
      cors(res);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      return res.end(out.body);
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Bike-share stations — curated GBFS systems merged server-side (keyless).
  if (url.pathname === '/bikeshare') {
    try {
      return json(res, 200, await getBikeshare());
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // NASA FIRMS thermal anomalies — proxied so the map key stays in .env, never
  // in client source. Passes source/box/days through; returns CSV.
  if (url.pathname === '/firms') {
    if (!CONFIG.firmsKey) {
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(''); // no key → empty; the layer reports OFF
    }
    const source = (url.searchParams.get('source') || 'VIIRS_NOAA20_NRT').replace(/[^A-Za-z0-9_]/g, '');
    const box = url.searchParams.get('box') || '-180,-90,180,90';
    const days = Math.min(10, Math.max(1, Number(url.searchParams.get('days')) || 1));
    if (!/^[-\d.,]+$/.test(box)) return json(res, 400, { error: 'bad box' });
    // FIRMS's area API intermittently answers header-only (no data rows) even
    // with a healthy key — observed mid-2026: the same query flips between 95k
    // rows and none within the hour. Remember the last GOOD body per query and
    // serve it (≤6 h old) whenever upstream comes back empty, so the layer
    // never goes blank because NASA is having a moment.
    const fKey = `${source}/${box}/${days}`;
    try {
      const r = await fetch(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${CONFIG.firmsKey}/${source}/${box}/${days}`,
      );
      let body = await r.text();
      const hasRows = r.ok && body.includes('\n') && body.trim().split('\n').length > 1;
      const cached = firmsCache.get(fKey);
      if (hasRows) {
        firmsCache.set(fKey, { t: Date.now(), body });
        if (firmsCache.size > 8) firmsCache.delete(firmsCache.keys().next().value);
      } else if (cached && Date.now() - cached.t < 6 * 3600e3) {
        body = cached.body;
      }
      cors(res);
      res.writeHead(hasRows || body.length > 200 ? 200 : r.status, { 'Content-Type': 'text/plain' });
      return res.end(body);
    } catch (e) {
      const cached = firmsCache.get(fKey);
      if (cached && Date.now() - cached.t < 6 * 3600e3) {
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(cached.body);
      }
      return json(res, 502, { error: String(e) });
    }
  }

  // Internet-outage annotations (Cloudflare Radar) — token injected server-side.
  // Cached 15 min. Returns per-outage location codes; the client places them.
  if (url.pathname === '/outages') {
    if (!CONFIG.cloudflareToken) return json(res, 200, { outages: [], note: 'no CLOUDFLARE_API_TOKEN' });
    if (outagesCache.data && Date.now() - outagesCache.t < 15 * 60e3)
      return json(res, 200, outagesCache.data);
    try {
      const r = await fetch(
        'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=28d&limit=100&format=json',
        { headers: { Authorization: `Bearer ${CONFIG.cloudflareToken}` } },
      );
      const j = await r.json();
      const outages = (j.result?.annotations || []).map((a) => ({
        id: a.id,
        description: a.description,
        cause: a.outage?.outageCause || null,
        type: a.outage?.outageType || null,
        codes: a.locations || [],
        names: (a.locationsDetails || []).map((l) => l.name),
        start: a.startDate,
        end: a.endDate,
        ongoing: !a.endDate,
        url: a.linkedUrl || null,
      }));
      outagesCache = { t: Date.now(), data: { outages } };
      return json(res, 200, outagesCache.data);
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Public webcams (Windy Webcams v3) — key injected server-side. With lat/lon
  // it returns cams near that point; without, a global popular-cams sweep (the
  // client uses that when zoomed way out, where a 200 km nearby circle is
  // usually empty ocean).
  if (url.pathname === '/webcams') {
    if (!CONFIG.windyKey) return json(res, 200, { webcams: [], note: 'no WINDY_WEBCAMS_KEY' });
    // parseFloat, not Number: Number(null) is 0, which would silently turn a
    // missing lat/lon into a nearby=0,0 query (Null Island — total 2 webcams).
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    const radius = Math.min(500, Math.max(5, Number(url.searchParams.get('radius')) || 200));
    const nearby = Number.isFinite(lat) && Number.isFinite(lon) ? `&nearby=${lat},${lon},${radius}` : '';
    try {
      const r = await fetch(
        `https://api.windy.com/webcams/api/v3/webcams?limit=50&sortKey=popularity&sortDirection=desc&include=images,location,urls${nearby}`,
        { headers: { 'x-windy-api-key': CONFIG.windyKey } },
      );
      const j = await r.json();
      const webcams = (j.webcams || [])
        .map((w) => ({
          id: w.webcamId,
          title: w.title,
          lat: w.location?.latitude,
          lon: w.location?.longitude,
          city: w.location?.city,
          country: w.location?.country,
          thumb: w.images?.current?.thumbnail,
          preview: w.images?.current?.preview,
          link: w.urls?.detail,
        }))
        .filter((w) => w.lat != null);
      return json(res, 200, { webcams, total: j.total ?? webcams.length });
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Nearest Mapillary street-level image to a point — token injected server-side.
  if (url.pathname === '/streetview') {
    if (!CONFIG.mapillaryToken) return json(res, 200, { image: null, note: 'no MAPILLARY_ACCESS_TOKEN' });
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: 'bad lat/lon' });
    const d = 0.0012; // ~130 m box — Mapillary rejects large bboxes
    try {
      const r = await fetch(
        `https://graph.mapillary.com/images?access_token=${CONFIG.mapillaryToken}` +
          `&bbox=${lon - d},${lat - d},${lon + d},${lat + d}` +
          `&fields=id,thumb_1024_url,computed_geometry,captured_at&limit=8`,
      );
      const j = await r.json();
      const imgs = (j.data || [])
        .map((im) => ({
          id: im.id,
          url: im.thumb_1024_url,
          lon: im.computed_geometry?.coordinates?.[0],
          lat: im.computed_geometry?.coordinates?.[1],
          t: im.captured_at,
        }))
        .filter((im) => im.url && im.lat != null);
      imgs.sort(
        (a, b) =>
          (a.lat - lat) ** 2 + (a.lon - lon) ** 2 - ((b.lat - lat) ** 2 + (b.lon - lon) ** 2),
      );
      return json(res, 200, { image: imgs[0] || null, count: imgs.length });
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Military aircraft — adsb.lol /v2/mil (CORS-blocked in-browser, so proxied).
  if (url.pathname === '/milair') {
    try {
      const r = await fetch('https://api.adsb.lol/v2/mil', {
        headers: { 'User-Agent': 'ARGUS/0.5 (github.com/Daswolfe/Argus)' },
      });
      cors(res);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // METAR/TAF proxy — aviationweather.gov (no key; proxied to sidestep CORS).
  if (url.pathname === '/avwx') {
    const ids = (url.searchParams.get('ids') || '').toUpperCase();
    if (!/^[A-Z0-9]{3,4}(,[A-Z0-9]{3,4})*$/.test(ids))
      return json(res, 400, { error: 'bad ids' });
    try {
      const r = await fetch(
        `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&taf=true`,
      );
      cors(res);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // Conflict clusters — GDELT 2.0 bulk events, rolling 24 h, clustered 0.5°.
  if (url.pathname === '/conflict') {
    try {
      return json(res, 200, await getConflict());
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  // OpenSky proxy — holds the OAuth2 secret server-side, passes bbox through.
  if (url.pathname === '/opensky') {
    try {
      const out = await fetchStates(url.search);
      cors(res);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      return res.end(out.body);
    } catch (e) {
      return json(res, 502, { error: String(e) });
    }
  }

  json(res, 404, { error: 'not found' });
});

// ── Websocket relay: push AIS updates + alerts to browser clients ──────
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }) =>
    (!CONFIG.token ||
      new URL(req.url, 'http://localhost').searchParams.get('token') === CONFIG.token) &&
    (!RL.wsMax || (RL.wsCount.get(clientIp(req)) ?? 0) < RL.wsMax),
});

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  RL.wsCount.set(ip, (RL.wsCount.get(ip) ?? 0) + 1);
  ws.on('close', () => {
    const n = (RL.wsCount.get(ip) ?? 1) - 1;
    if (n <= 0) RL.wsCount.delete(ip);
    else RL.wsCount.set(ip, n);
  });
  // Bring the new client up to speed immediately.
  ws.send(JSON.stringify({ type: 'snapshot', ...relay.snapshot() }));
});

function broadcast(obj) {
  const data = JSON.stringify(obj); // serialized once for all clients
  for (const client of wss.clients) {
    // Backpressure: a client that can't drain 8 MB is stalled — skip it rather
    // than buffer without bound. Update batches are cumulative-state deltas,
    // so a dropped frame is simply superseded by the next one.
    if (client.readyState === 1 && client.bufferedAmount < 8e6) client.send(data);
  }
}
relay.on('update', (vessels) => broadcast({ type: 'update', vessels }));
// Maritime alerts get cross-layer context (GPS-denied zones, conflict
// clusters near the event) before they reach the browser, and are archived.
async function pushAlert(a) {
  const enriched = await correlate(a).catch(() => a);
  broadcast({ type: 'alert', ...enriched });
  try {
    db?.saveAlert(enriched);
  } catch (_) {}
}
relay.on('alert', pushAlert);
analytics.on('alert', pushAlert);
// Persist vessel breadcrumb fixes so tracks survive restarts.
if (db) relay.on('fix', (mmsi, t, lat, lon) => db.saveFix(mmsi, t, lat, lon));

relay.start();
analytics.start();

server.listen(CONFIG.port, () => {
  console.log(`ARGUS backend on :${CONFIG.port}`);
  console.log(`  • REST  http://localhost:${CONFIG.port}/health`);
  console.log(`  • WS    ws://localhost:${CONFIG.port}/ws`);
  console.log(
    relay.enabled
      ? `  • AIS   aisstream relay ACTIVE (${CONFIG.ais.boxes.length} chokepoint boxes)`
      : `  • AIS   no AISSTREAM_KEY set — frontend will use its simulation`,
  );
  console.log(
    openskyAuthed()
      ? '  • SKY   OpenSky OAuth2 proxy ready (/opensky)'
      : '  • SKY   OpenSky credentials not set — anonymous tier only',
  );
});
