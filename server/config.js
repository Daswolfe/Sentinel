import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

// Load .env from the REPO ROOT (one level up from server/), not the current
// working directory. The .env.example template lives at the root, so users
// naturally create .env there — this makes sure we read it wherever the
// backend is launched from. Falls back to a local server/.env if present.
//
// We parse it ourselves (instead of dotenv) so we can tolerate the two things
// that trip people up on Windows: a UTF-8 BOM at the start of the file, and
// stray quotes/whitespace around values. Only sets vars not already in the
// environment, so real env vars still win.
function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // file not present — that's fine
  }
  text = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM if present
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip a single pair of surrounding quotes, if any
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(here, '..', '.env')); // repo-root .env
loadEnvFile(join(here, '.env')); // optional server/.env

export const CONFIG = {
  // Deliberately NOT the generic PORT: dev harnesses and PaaS hosts inject
  // PORT for the *frontend*, which would steal the backend's port.
  port: Number(process.env.BACKEND_PORT || 8787),

  // Optional shared bearer token. Empty (default) = open, fine on localhost.
  // Set BACKEND_TOKEN before exposing the port: REST needs Authorization:
  // Bearer <token> (or ?token=), the websocket needs /ws?token=<token>.
  token: process.env.BACKEND_TOKEN || '',

  aisstreamKey: process.env.AISSTREAM_KEY || '',

  // NASA FIRMS map key — injected server-side by the /firms proxy so it never
  // ships in client source. Free key at firms.modaps.eosdis.nasa.gov.
  firmsKey: process.env.FIRMS_MAP_KEY || '',

  // Phase B: public webcams (Windy) + street-level imagery (Mapillary), both
  // proxied so the keys stay server-side.
  windyKey: process.env.WINDY_WEBCAMS_KEY || '',
  mapillaryToken: process.env.MAPILLARY_ACCESS_TOKEN || '',

  // Cloudflare Radar API token — internet-outage annotations (Net Outages layer).
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN || '',

  // Local LLM (Ollama) for intel reports. The backend proxies to it so the
  // browser needs no CORS config — Ollama can keep its default localhost bind.
  llm: {
    endpoint: process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate',
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
  },

  opensky: {
    id: process.env.OPENSKY_ID || '',
    secret: process.env.OPENSKY_SECRET || '',
    tokenUrl:
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    statesUrl: 'https://opensky-network.org/api/states/all',
  },

  ais: {
    endpoint: 'wss://stream.aisstream.io/v0/stream',

    // aisstream bounding boxes: [[ [latMin,lonMin], [latMax,lonMax] ], ...]
    // GLOBAL subscription — everything aisstream hears, worldwide, tiled into
    // 8 quadrant boxes. NOTE: aisstream's free feed is volunteer TERRESTRIAL
    // receivers only — regions without active receivers (observed: Persian
    // Gulf / India sector) deliver nothing no matter what boxes you request.
    // Satellite AIS (Spire, exactEarth, …) is the paid fix for true global
    // coverage. The maxVessels guard below caps memory. For a lighter,
    // chokepoint-focused feed, swap in the preset below instead.
    boxes: [
      [[0.0, -180.0], [90.0, -90.0]],
      [[0.0, -90.0], [90.0, 0.0]],
      [[0.0, 0.0], [90.0, 90.0]],
      [[0.0, 90.0], [90.0, 180.0]],
      [[-90.0, -180.0], [0.0, -90.0]],
      [[-90.0, -90.0], [0.0, 0.0]],
      [[-90.0, 0.0], [0.0, 90.0]],
      [[-90.0, 90.0], [0.0, 180.0]],
    ],
    // Chokepoint preset (light bandwidth, precise dark-ship suppression):
    // boxes: [
    //   [[22.0, 50.0], [30.0, 62.0]],   // Strait of Hormuz / Persian Gulf
    //   [[10.0, 30.0], [32.0, 46.0]],   // Red Sea / Suez / Bab-el-Mandeb
    //   [[-3.0, 93.0], [9.0, 108.0]],   // Strait of Malacca
    //   [[19.0, 112.0], [29.0, 127.0]], // Taiwan Strait
    //   [[4.0, 105.0], [24.0, 122.0]],  // South China Sea
    //   [[40.0, 26.0], [48.0, 42.0]],   // Black Sea
    //   [[35.0, -6.5], [37.0, -4.5]],   // Strait of Gibraltar
    //   [[5.0, -84.0], [13.0, -76.0]],  // Panama approaches
    //   [[49.5, -2.0], [51.5, 2.5]],    // English Channel / Dover
    // ],

    // Dark-ship heuristic.
    underwaySog: 3,          // knots — a vessel moving faster than this is "underway"
    darkThresholdMin: 30,    // silent this long while underway => flagged dark
    minReportsBeforeDark: 2, // need a short track first (avoids one-off blips)
    scanIntervalMs: 60_000,  // how often to re-scan for newly-dark vessels
    broadcastMs: 2_000,      // batch position updates to clients this often
    maxVessels: 100_000,     // memory guard (global feed peaks well under this)
    staleEvictMin: 180,      // drop vessels unseen this long (incl. dark) to free memory
  },
};
