# ARGUS

An open-source **4D geospatial command center**. One 3D globe fusing live
satellites, aircraft, **maritime AIS with dark-ship detection**, seismic events,
conflict/news, rocket launches, thermal anomalies, and NASA imagery — with a
4D time scrubber, region focus, an alert engine, and optional local-LLM intel
reports.

---

sentinel/
├── server/                 Node backend (no framework, minimal deps)
│   ├── index.js            HTTP (health, /opensky[/track], /ais/snapshot|track,
│   │                       /gpsjam, /conflict, /avwx) + WS relay + optional auth
│   ├── ais.js          ★   aisstream client + vessel state + DARK-SHIP engine
│   ├── analytics.js    ★   STS-transfer detection + cross-layer correlation
│   ├── ports.js        ★   ports/anchorages index — suppresses in-port silences
│   ├── gdelt.js        ★   GDELT 2.0 bulk-event ingester (rolling 24 h clusters)
│   ├── gpsjam.js           gpsjam.org daily H3 → GPS-DENIED zones + cells
│   ├── bikeshare.js        curated GBFS systems → merged station availability
│   ├── opensky.js          OAuth2 token manager + states/tracks proxy
│   ├── db.js               optional SQLite persistence (tracks 48 h, alerts 30 d)
│   ├── verify-ais.js   ★   run when online: checks aisstream schema vs ais.js
│   ├── fixtures/           captured live AIS message — schema lock for tests
│   ├── config.js           AIS boxes (global default), thresholds, auth token
│   └── data/               wpi.json (NGA ~2,900 ports) + anchorages.json
│                           (GFW ~14,700 named anchorages, AIS-derived)
├── web/                    Vite frontend (vanilla JS — Three.js is imperative,
│   ├── index.html          so no React tax)
│   ├── vite.config.js      dev proxy: /api + /ws → backend
│   ├── registry.test.js    tests for the layer registry/context
│   └── src/
│       ├── main.js     ★   HOST: globe + wiring + UI/picking/timeline/alerts
│       ├── registry.js ★   LayerContext + LayerRegistry (the layer framework)
│       │                   + region filtering + contact filters + icon sprites
│       ├── tiles.js    ★   deep-zoom ground imagery (Esri tiles on the sphere)
│       ├── radar.js        global animated precip radar (RainViewer mercator drape)
│       ├── markers.js  ★   ghost trails + heading-oriented arrow markers
│       ├── runways.js      airport diagrams + wind-based runway-in-use logic
│       ├── contactFilters.js  nationality (MID / hex blocks), mil-civ, watchlist
│       ├── labels.js       billboarded text sprites (nation/city names)
│       ├── config.js       all layer config + region presets
│       ├── globe.js        shared geo helpers (GLOBE_R, llToV)
│       ├── style.css
│       └── layers/     ★   ONE FILE PER DATA SOURCE
│           ├── satellites.js  aircraft.js  milair.js  sea.js  seismic.js
│           ├── events.js  conflict.js  launches.js  thermal.js
│           ├── jamming.js  airports.js  cities.js  bikeshare.js  stubs.js
│           └── maritime.js    (live-AIS websocket client used by sea.js)
├── .env.example            copy → .env, add your keys
└── package.json            workspaces + one `npm run dev`
```

**Frontend choice:** Vite + vanilla JS, not React/Next. The globe is imperative
Three.js; a component framework would fight it and add weight for no gain. Vite
gives you HMR, a real build, and npm dependencies (Three.js and satellite.js are
now proper imports, not CDN globals).

**Want a real desktop app later?** Wrap `web/` in **Tauri** (Rust shell, ~10 MB
installer) for a native "runs locally on a machine" build without shipping a whole
Chromium like Electron. The backend can run as a sidecar process. Not needed now —
noted for the roadmap.

## Adding a new layer (the whole point of the refactor)

Every data source is a self-contained module in `web/src/layers/`. A layer is a
plain object with an `id`, a `load(ctx)` that fetches and plots, and optional
lifecycle hooks. It never touches a global — everything comes through `ctx`.

```js
// web/src/layers/mylayer.js
import { CONFIG } from '../config.js';

export default {
  id: 'MINE',
  name: 'My Layer',
  color: 0x44ff88, css: '#44ff88',
  interval: 5 * 60e3,          // optional auto-refresh (ms)

  async load(ctx) {
    ctx.ui.status('MINE', 'wait');
    const data = await (await fetch('https://…')).json();
    const pos = new Float32Array(data.length * 3);
    const meta = [];
    data.forEach((d, i) => {
      const v = ctx.llToV(d.lat, d.lon, ctx.R + 0.5);   // shared geo helper
      pos[i*3] = v.x; pos[i*3+1] = v.y; pos[i*3+2] = v.z;
      meta.push({ layer: 'MINE', headline: d.name, rows: { /* detail panel */ } });
    });
    ctx.setLayerData('MINE', pos, meta);                // plot it
    ctx.ui.status('MINE', 'ok');
  },

  // Optional hooks:
  //   init(ctx)        one-time setup (add scene objects, open a socket)
  //   tick(ctx)        called on the fast ticker (e.g. satellites propagate)
  //   onScrub(ctx, t)  re-render for the 4D time scrubber (t = epoch ms or null)
  //   onRegion(ctx)    react to region-focus change (ctx.region())
  //   companions:[…]   extra layer defs this module also renders into (see sea.js)
  //   onVisible(on)    react to the sidebar toggle (e.g. aircraft trails)
};
```

Then register it in `web/src/main.js`:
```js
import mylayer from './layers/mylayer.js';
registry.addAll([ …, mylayer ]);
```

That's it — the sidebar row, status dot, refresh timer, picking, scrubber, and
alert plumbing all work automatically. **The core (`main.js`) never changes when
you add a layer.** `ctx` gives a layer: `setLayerData` / `setLive` (scrubber-aware),
`llToV` + `R`, `ui` (status/count/tick), `alerts`, `region()`, `scrubTime()`, and
the shared `scene` + `THREE`.

---

## Quick start

```bash
# 1. install (root installs both workspaces)
npm install

# 2. add your keys
cp .env.example .env        # then edit .env

# 3. run backend + frontend together
npm run dev
# frontend  → http://localhost:5173
# backend   → http://localhost:8787  (health: /health)
```

Runs with **no keys at all** — you just get the maritime *simulation* instead of
live AIS, and anonymous (rate-limited) aircraft. Add keys to go live.

To run the pieces separately: `npm run dev:server` and `npm run dev:web`.

---

## The maritime pipeline (the focus of this build)

Live AIS is the reason a backend exists. Here's the full path:

```
aisstream.io  ──wss──►  server/ais.js  ──►  server/index.js  ──ws──►  web/…/maritime.js  ──►  globe
 (raw messages)        (state + dark          (relay +               (vessel map +          (SEA + DARK
                        detection)             snapshot)              alert routing)          layers)
```

### 1. Get a key (free)
Sign in at **[aisstream.io](https://aisstream.io)** with GitHub, copy the key into
`.env` as `AISSTREAM_KEY=…`. Restart the backend. That's it — the relay connects,
subscribes to the chokepoint bounding boxes in `server/config.js`, and starts
streaming.

**Before trusting the feed, verify the schema** (do this the first time you're
online):
```bash
npm run verify-ais
```
This connects to aisstream, captures real messages from a busy box (Singapore
Strait), and confirms every field `ais.js` reads actually exists in the live
payload. If aisstream ever changes their schema, it prints exactly which path
drifted so you fix `_ingest()` in one place instead of debugging blind.

### 2. What the backend does (`server/ais.js` + `server/ports.js`)
- Connects to aisstream over websocket with auto-reconnect + exponential backoff.
- Subscribes **globally** by default (8 quadrant boxes — tens of thousands of
  vessels; a lighter chokepoint preset is commented in `config.js`). Note:
  aisstream's free feed is volunteer *terrestrial* receivers — sectors without
  active receivers (observed: Persian Gulf / India) deliver nothing; satellite AIS
  (paid) is the fix for guaranteed coverage.
- Maintains **one clean record per MMSI** (position, SOG, COG, heading, name, type,
  destination) — deduplicating the raw firehose.
- Runs the **dark-ship engine**: a vessel that was *underway* (SOG ≥ 3 kt) and then
  goes *silent past the threshold* (default 30 min) is flagged **DARK** — the
  classic "AIS off" tradecraft for sanctions evasion and covert ship-to-ship
  transfers. When a dark vessel transmits again, it emits a **resurface** alert with
  how long it was dark and how far it jumped (great-circle nm).
- **Suppresses false positives with a ports/anchorages filter** (`ports.js`):
  a vessel that goes quiet within range of a known port or anchorage is *not*
  flagged, because berthing/anchoring silence is legitimate. Backed by **~17.7k
  anchorages/ports**: the NGA **World Port Index** (~2,900, public domain,
  `server/data/wpi.json`) **+ Global Fishing Watch named anchorages** (~14,700,
  AIS-derived — where ships *actually* sit still — grouped from 166k S2 cells into
  `server/data/anchorages.json`) + a curated chokepoint seed list, all indexed on
  a coarse spatial grid for fast lookup. The `/health` endpoint reports how many
  flags were raised vs. suppressed so you can tune the thresholds.
- **Batches** position updates every 2 s and pushes them (plus immediate alerts)
  to all connected browsers. Late-joiners get a full snapshot on connect.

Tunable knobs (`config.js` → `ais`): `underwaySog`, `darkThresholdMin`,
`minReportsBeforeDark`, `broadcastMs`, `boxes`, memory guards.

### Analytics on top of the picture (`server/analytics.js`)
- **STS-transfer candidates**: two vessels stopped (≤ 0.8 kt), ≤ 500 m apart, away
  from any port/anchorage, holding ≥ 25 min → alert with separation + hold time.
- **Loitering**: a single vessel stopped in open water (anchorage-filtered) for
  ≥ 3 h → alert. The GFW anchorage index above is what keeps this from firing on
  every legitimately anchored ship.
- **Cross-layer correlation**: every maritime alert is enriched before broadcast —
  is the event inside/near a GPS-denied zone? are there conflict clusters within
  250 km? The context rides on the alert text in the UI.
- **Persistence** (`server/db.js`, optional): vessel breadcrumb fixes (48 h) and
  alerts (30 d) in WAL-mode SQLite survive restarts; `/ais/track` serves the longer
  history transparently. If `better-sqlite3` isn't available the server just runs
  without it.
- **Auth**: set `BACKEND_TOKEN` in `.env` before exposing the backend beyond
  localhost — REST then wants `Authorization: Bearer <token>` (or `?token=`), the
  websocket wants `/ws?token=`.

### 3. What the frontend does (`web/src/layers/maritime.js`)
A pure module (no THREE/DOM) that connects to the relay, keeps a local vessel map
in sync from `snapshot` + `update` messages, and hands clean arrays plus alerts to
callbacks. `main.js` turns those into globe points on the **SEA** and **DARK**
layers and routes alerts into the existing alert engine. If the backend is down,
`CONFIG.SEA.live` stays false and the built-in simulation transparently takes over.

### Verify it's working
```bash
curl http://localhost:8787/health
# → { ok:true, ais:{ enabled:true, status:"ok", tracked: <n> }, … }
```

---

## Aircraft: OpenSky OAuth2 (higher limits)

Put `OPENSKY_ID` / `OPENSKY_SECRET` in `.env` (create an API client on your OpenSky
account page). The frontend calls `/api/opensky`, and the backend attaches the
bearer token server-side — so the secret never reaches the browser, and you get
4,000 credits/day (8,000 if you feed a receiver — see the receiver build in the
main setup guide). Region Focus narrows the bounding box to keep credits cheap.

---

## Other layers

All keyless and live out of the box: satellites (CelesTrak `active` catalog + SGP4,
propagated client-side, TLEs cached against CelesTrak's 2 h re-download throttle),
seismic (USGS, magnitude slider — defaults to **M ≥ 4.5**, destructive events),
weather/events (NASA EONET + Open-Meteo), conflict/news (GDELT 2.0 **bulk events**
ingested by the backend — the old GDELT GEO JSON API is dead), GPS jamming
(gpsjam.org via the backend, thresholded to the deliberate-interference band and
clustered into ringed **GPS-DENIED ZONES**), launches (Launch Library 2),
**airports** (OurAirports large/medium — click a field for **decoded METAR/TAF, a
wind compass rose, and a runway diagram with the into-wind runways highlighted**),
**cities** (Natural Earth, default-off), aircraft dossiers (adsbdb), imagery (NASA
GIBS: HD 8K Blue Marble or daily MODIS — plus **Esri World Imagery tiles that
stream in under the camera below ~2,200 km altitude, down to building scale**).
Thermal/fire needs a free NASA FIRMS key and ships a realistic default cut
(FRP ≥ 10 MW, with plain-English fire-scale context in the detail panel).
Power/internet outages and X/social are stubbed with labeled adapters.

Also live and keyless: **military aircraft** (adsb.lol's global mil feed, via the
backend), **bike share** (curated GBFS systems merged server-side — ~10k stations
across NYC/Chicago/Paris/Montréal/Toronto/… with live bikes/docks, a lazy default-off
layer), and a **global precipitation-radar** overlay (`⛆ RADAR` — RainViewer's mosaic
fuses US NOAA NEXRAD with worldwide radar, animated through the last ~2 h of frames).

**Movers carry ghost trails and heading arrows.** Aircraft, ships, and satellites
draw a short fading breadcrumb trail (always on, for every contact — not just the
focused one). Aircraft, military aircraft, and ships default to **direction-oriented
arrow markers** (chevrons laid flat on the globe pointing along track/COG); the icon
picker switches any oriented layer between the arrow and a dot/glyph.

**Contacts are interactive**: click an aircraft for its full flight path plus an
altitude/ground-speed profile panel (OpenSky tracks API); click a vessel for its
breadcrumb history; **double-click any object to orbit-focus it** (the camera
swivels around the object's local vertical — double-click empty space to release).
A header **search bar** finds contacts by name / MMSI / callsign / hex. Sidebar
filters cut the plot by **flag state, military vs civilian, or a notable-contact
watchlist**; each layer row has a **color picker and icon picker** (persisted).

Every sidebar row shows a data-provenance badge — **LIVE** (real data), **SIM**
(synthetic), **OFF** (not wired / no key), **ERR** (source failed). Alerts are
click-to-locate, acknowledgeable, and deletable. Region Focus hides all data
originating outside the selected bbox; satellites are kept if they have line of
sight to the region. A **DVR** records one frame a minute to IndexedDB (window
adjustable up to 48 h) so the 4D scrubber reaches hours back, and 📷 SNAPSHOT
exports the whole global picture as JSON. The header health strip mirrors
`/health` (tracked vessels, dark flags vs suppressions, STS alerts, DB status).

---

## Deploying

Behind one reverse proxy (nginx/Caddy): serve the built `web/dist` statically and
route `/api/*` and `/ws` to the Node backend. Because dev already uses those same
paths via the Vite proxy, nothing changes between dev and prod.

## License

MIT. Respect each data provider's terms of use (see `LICENSE`).
