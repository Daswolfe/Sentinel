# ARGUS

An open-source **4D geospatial command center**. One Three.js globe fusing live
satellites, aircraft (civil + military), maritime AIS with **dark-ship
detection**, seismic, conflict/news, GPS jamming, thermal, launches, airports,
webcams, and more — with deep-zoom imagery + 3D buildings, weather radar, a 4D
time scrubber, tripwires, per-nation dossiers, an alert engine, and local-LLM
intel reports. Runs on one machine; shareable to any browser you hand a link.

> **Never used a terminal?** Read **`GETTING-STARTED.md`** first — it assumes
> nothing. This file is the full reference.

---

## 1. Quick start

Prerequisite: **Node.js 18+**.

```bash
npm install          # both workspaces (server + web)
cp .env.example .env # optional — add keys as you get them
npm run dev          # backend :8787 + frontend :5173 together
```

Open **http://localhost:5173**. ARGUS runs with **zero keys** — you get every
keyless layer live (satellites, aircraft on the anonymous tier, seismic,
weather, conflict, jamming, launches, airports, cities, sea boundaries, radar,
military air, bike share) and a maritime *simulation* until you add an AIS key.
Every sidebar row carries a provenance badge: **LIVE** real data · **SIM**
synthetic · **OFF** not wired / no key · **ERR** source failed.

`npm test` runs the suite (20 tests, no network). `npm run build` produces
`web/dist`, which the backend serves itself at `http://localhost:8787/`.

---

## 2. Going live — keys in build order

Each step is independent and additive. All secrets go in **`.env`** (gitignored);
frontend tuning lives in **`web/src/config.js`**.

| Step | Key / setup | Unlocks |
|---|---|---|
| 1 | *(nothing)* | globe + all keyless layers |
| 2 | `OPENSKY_ID` / `OPENSKY_SECRET` — free API client on your OpenSky account page | aircraft 400 → 4,000 pulls/day (backend does the OAuth2; secret never reaches the browser) |
| 3 | `AISSTREAM_KEY` — free at aisstream.io (GitHub sign-in) | live global AIS + the dark-ship / STS / loitering engines. Run **`npm run verify-ais`** once online to confirm the feed schema. |
| 4 | `FIRMS_MAP_KEY` — free at firms.modaps.eosdis.nasa.gov | thermal/fire layer (VIIRS NOAA-20/21 with automatic failover; backend keeps the last good pull ≤6 h because NASA's area API is moody) |
| 5 | `WINDY_WEBCAMS_KEY` / `MAPILLARY_ACCESS_TOKEN` | public webcams layer + street-level imagery on surface click |
| 6 | `CLOUDFLARE_API_TOKEN` | internet-outage annotations (Net Outages layer) |
| 7 | [Ollama](https://ollama.com) + `ollama pull llama3.1:8b` | streamed intel SITREPs + per-nation dossier briefs, fully local (`OLLAMA_MODEL` to swap models) |
| 8 | Own ADS-B receiver (see §8) | unlimited local aircraft feed + OpenSky 8,000/day contributor tier |

---

## 3. Sharing your instance (one host, many viewers)

Your machine runs the backend and holds the keys; friends open a link. Short-TTL
response caching means N viewers cost the same upstream quota as one.

1. `npm run build` — the backend serves `web/dist` itself, no nginx needed.
2. In `.env` set `BACKEND_TOKEN=<long-random-string>`, then `npm start`.
3. Open the firewall (Windows, admin PowerShell):
   `netsh advfirewall firewall add rule name="ARGUS" dir=in action=allow protocol=TCP localport=8787`
4. Share **`http://<your-LAN-IP>:8787/?token=<token>`**. The token stores
   client-side on first open, scrubs itself from the URL, and rides every API
   call + the websocket automatically.

Outside your LAN: forward TCP 8787 on your router and share your public IP the
same way. Already on for you: per-IP rate limiting (`RATE_LIMIT_PER_MIN`,
default 300), a websocket cap (`WS_MAX_PER_IP`, default 4), and the shared
upstream cache. Plain HTTP sends the token in the clear — fine among friends;
put a TLS proxy (Caddy) in front for anything more. Each viewer keeps their own
watchlists/tripwires/dossiers (browser-local); the live picture, alerts, and
analytics are shared. Or ship the code instead: `git archive --format=zip -o
ARGUS.zip HEAD` (never zip the folder raw — it contains your `.env`).

## 4. Desktop app

`npm run desktop` (needs Rust + the repo) builds a native shell:
`src-tauri/target/release/argus-desktop.exe` and an NSIS installer under
`…/bundle/nsis/`. The exe spawns `node server/index.js`, waits for :8787, and
opens a window on the same-origin UI; closing it kills the backend (a parent-PID
watchdog covers force-kills). The installer ships only the shell — the machine
still needs Node and this repo.

## 5. Recorded-scenario replay (demo / offline mode)

Capture the live AIS feed, replay it later with **no key** — the full ingest
path runs (dark-ship, STS, loitering, alerts), looping at end-of-file. The
health strip shows REPLAY.

```
AIS_RECORD=data/scenario.ndjson   # tap the live feed to a file (needs a key)
AIS_REPLAY=data/scenario.ndjson   # play it back, keyless
AIS_REPLAY_SPEED=10               # 1 h of capture in 6 min
```

---

## 6. The maritime pipeline

```
aisstream.io ──wss──► server/ais.js ──► index.js ──ws──► layers/sea.js ──► globe
              (state + dark engine)      (relay)          (SEA + DARK)
```

- **One clean record per MMSI**, deduplicated from the raw firehose; position
  updates batched every 2 s; late joiners get a snapshot.
- **Dark ships**: underway (≥3 kt) then silent past 30 min → DARK flag; a
  transmit after that → **resurface** alert with dark-minutes + jump nm.
  False positives suppressed by **~17.7k ports/anchorages** (NGA WPI + Global
  Fishing Watch named anchorages + curated chokepoints).
- **STS transfers**: two vessels ≤0.8 kt, ≤500 m apart, ≥25 min, away from any
  anchorage **and ≥5 nm from any coastline** (`STS_MIN_SHORE_NM`, 0 disables) —
  the shore rule keeps rafted ships in nearshore roadsteads from false-flagging.
- **Loitering**: one vessel stopped in open water ≥3 h (anchorage-filtered).
- **Correlation**: every maritime alert is enriched server-side — inside a
  GPS-denied zone? conflict clusters nearby? — before it reaches the UI.
- **Persistence** (optional, auto-detected): WAL SQLite keeps vessel fixes 48 h
  + alerts 30 d; the History panel queries it by time / kind / region.
- Coverage caveat: aisstream's free feed is volunteer *terrestrial* receivers —
  some sectors (Persian Gulf / India observed) deliver nothing. Paid satellite
  AIS is the only fix.

Thresholds live in `server/config.js` (`ais` block) and `.env`; `/health`
reports flags-vs-suppressions so you can tune. Detection quality knobs that
came from live tuning: surveillance-orbit trigger needs **10 full loops**
(practice-circuit proof), STS shore rule above.

---

## 7. What's on the globe

**Layers** — satellites (full CelesTrak active catalog, client-side SGP4),
aircraft + military air (oriented ✈), maritime AIS + dark ships (oriented ➤,
ghost trails on all movers), seismic (M≥4.5 slider), weather/events (EONET +
point weather with wind rose), conflict/news (GDELT 2.0 bulk events, 24 h,
threats & force posture through mass violence, clustered with actors + top
stories), GPS jamming (denied-zone hulls), thermal/fire (FIRMS, plain-English
fire scale), launches, airports (decoded METAR/TAF + runway-in-use diagram),
cities, **sea boundaries** (EEZ blue / disputed red / 24 nm violet / 12 nm teal,
Marine Regions v12), bike share, webcams, net outages, weather radar (⛆),
deep-zoom Esri imagery in a two-level pyramid (no black edges when tilted) +
OSM Buildings 3D extrusions (⌂), day/night terminator (☾).

**Operator UI** — header search (name/MMSI/callsign/hex); region presets
(Hormuz, Taiwan Strait, …) that focus every layer and narrow API queries;
click = detail panel (+flight profile for aircraft), double-click = orbit-focus,
right-drag at low altitude = free-look; ⤢ MEASURE great-circle tape; ⚙ UNITS
panel (ft/m/FL · kt/km·h/mph · nm/km/mi · °C/°F · DD/DMS); per-layer style menus
(colour/icon/size, persisted); contact filters (flag state, mil/civ, watchlist,
underway, altitude/orbit bands, ship class, aircraft category, emergency-only,
fast movers, dark-duration, constellation, flight stage, density cap);
draggable/collapsible panels (off-screen positions self-heal); alerts with
sound toggle 🔔, ack/delete/click-to-locate; 4D scrubber + DVR (IndexedDB, ≤48 h)
+ 📷 snapshot export.

**Intelligence** — tripwires (draw a polygon or pick a nation's airspace; counts
in/out by class and logs *who* crossed — click a crossing to re-focus it);
surveillance-orbit detector; per-nation dossiers auto-accrued from attributable
alerts (clickable events, streamed LLM briefs); pattern-of-life history queries;
nation highlight walls; watchlist with alert-on-appear; ⌁ SITREP report that
leads with cross-layer-correlated events.

## 8. Adding a layer (the architecture)

```
server/   no-framework Node: AIS relay + analytics, per-source proxies (secrets
          stay here), rate limiting, static hosting of web/dist, SQLite
web/src/  Vite + vanilla Three.js. main.js is the host; registry.js is the
          framework; every data source is ONE FILE in web/src/layers/.
```

A layer never touches a global — everything arrives through `ctx`:

```js
// web/src/layers/mylayer.js
export default {
  id: 'MINE', name: 'My Layer', color: 0x44ff88, css: '#44ff88',
  interval: 5 * 60e3,               // optional auto-refresh
  async load(ctx) {
    ctx.ui.status('MINE', 'wait');
    const data = await (await fetch('https://…')).json();
    const pos = new Float32Array(data.length * 3);
    const meta = [];
    data.forEach((d, i) => {
      const v = ctx.llToV(d.lat, d.lon, ctx.R + 0.5);
      pos.set([v.x, v.y, v.z], i * 3);
      meta.push({ layer: 'MINE', lat: d.lat, lon: d.lon,
                  headline: d.name, rows: { /* detail panel */ } });
    });
    ctx.setLayerData('MINE', pos, meta);
    ctx.ui.status('MINE', 'ok');
  },
  // optional hooks: init(ctx) · tick(ctx) · onScrub(ctx,t) · onRegion(ctx)
  //                 onVisible(on) · lazy:true · defaultOff:true · companions:[…]
};
```

Import it in `main.js`, add to `registry.addAll([...])` — sidebar row, status
badge, timers, picking, scrubber, and filters all come free. Use `setLive`
instead of `setLayerData` to make a layer time-scrubbable.

**Data prep scripts** (`server/data/`, one-time, outputs committed):
`convert-anchorages.mjs` (GFW CSV → anchorage index), `convert-maritime.mjs`
(Marine Regions WFS → EEZ/12nm/24nm boundary polylines),
`convert-coast.mjs` (Natural Earth coastline → shore-distance samples).

## 9. Own ADS-B receiver (optional hardware)

RTL-SDR dongle + 1090 MHz antenna + Raspberry Pi (~$40–70), flashed with the
**adsb.im** image. Feed OpenSky (Feeder page → request a serial; ≥30% monthly
uptime = 8,000 credits/day), then point `AIR.localFeed` in `web/src/config.js`
at your tar1090 JSON (`http://<pi>:8080/data/aircraft.json`) for unlimited
local traffic.

---

## 10. `.env` reference

| Key | Purpose |
|---|---|
| `BACKEND_PORT` | backend port (default 8787) |
| `BACKEND_TOKEN` | access token — REQUIRED before exposing beyond localhost (§3) |
| `RATE_LIMIT_PER_MIN` / `WS_MAX_PER_IP` / `TRUST_PROXY` | per-IP request cap (300, 0=off) · websocket cap (4) · honor X-Forwarded-For behind a proxy |
| `AISSTREAM_KEY` | live maritime AIS |
| `AIS_RECORD` / `AIS_REPLAY` / `AIS_REPLAY_SPEED` | scenario capture + keyless replay (§5) |
| `STS_MIN_SHORE_NM` | STS shore rule, nm from coastline (default 5, 0 disables) |
| `OPENSKY_ID` / `OPENSKY_SECRET` | OpenSky OAuth2 |
| `FIRMS_MAP_KEY` | NASA FIRMS thermal |
| `WINDY_WEBCAMS_KEY` / `MAPILLARY_ACCESS_TOKEN` | webcams / street-level |
| `CLOUDFLARE_API_TOKEN` | net outages |
| `OLLAMA_URL` / `OLLAMA_MODEL` | local LLM (default `llama3.1:8b`) |
| `GOOGLE_MAPS_KEY` / `GOOGLE_TILES_MONTHLY_CAP` | Photorealistic 3D Tiles (shelved — see §12). The backend meters root requests (cap 900/mo of the 1,000 free) so the key can never accrue charges |

Frontend knobs (`web/src/config.js`): layer URLs/refresh rates, `AIR.localFeed`,
FIRMS source + fire-power cut, jamming thresholds, DVR cadence, region presets,
`BUILDINGS.provider` (`'osm'` default / `'google'` experimental).

## 11. Deploying

- **Simplest**: §3 — the backend serves everything on :8787.
- **Docker**: `docker compose up --build` → nginx on :8080 serving `web/dist`,
  proxying `/api` + `/ws` to the backend container.
- **Reverse proxy**: serve `web/dist`, route `/api/*` and `/ws` to :8787 — same
  paths as dev, nothing changes.

## 12. Status, shelved & backlog

**Done** (Themes 1–4, mid-2026): intelligence depth (correlation→SITREP,
watchlist v2, tripwires + airspace, orbit detector, loitering, dossiers,
history), new sensors (webcams, street-level, net outages), cartography
(jamming hulls, nation walls, sea boundaries), UX/packaging (units panel,
Docker, rate limiting, desktop shell, replay), optimization pass (persistent
GPU buffers, meta-based region filter, backpressure guard), shared-viewer
hosting.

**Shelved** — *Google Photorealistic 3D Tiles*: streaming, registration, and a
hard billing gate all work (`CONFIG.BUILDINGS.provider='google'` to resume),
but a deep-zoom render-pass conflict (viewport collapses to one draw call)
needs diagnosis; OSM extrusions remain active. *Contributor on-ramp*: per
operator choice. *Multi-user via tunnels*: superseded by direct hosting (§3).

**Backlog**: route-anomaly detection (needs a lane baseline from the SQLite
archive or EMODnet/MarineCadastre rasters), FIR/airspace boundary data, power
outages + X/social stubs, satellite constellation grouping polish, binary WS
frames if viewer counts grow.

**Known limits**: FIRMS area API intermittently returns empty (mitigated by
last-good caching); aisstream terrestrial coverage gaps; WebGL screenshot
capture resists the dev harness (verify via scene introspection).

**User feature log**: dark-ship pulse ring at last known location — ✅ shipped
(`web/src/darkpulse.js`).

## License

MIT. Respect each data provider's terms (see `LICENSE`).
