# ARGUS — Setup & Build Guide

How to run the repo, build the ADS-B receiver that unlocks higher aircraft limits,
and turn each optional layer from SIM/STUB into LIVE.

> **New to coding / terminals?** Start with **`GETTING-STARTED.md`** instead — it
> walks through installing Node.js, opening a terminal, and running the commands
> with nothing assumed. Come back here for the fuller reference once it's running.

> **Design rule:** nothing here is a hard dependency. ARGUS runs today with
> `npm install && npm run dev`, zero keys required — you just get simulated maritime
> and rate-limited aircraft. Every step below is *additive*: it turns one more layer
> live or removes a rate limit. Every sidebar row carries a badge showing exactly
> where you are: **LIVE** = real data flowing, **SIM** = synthetic/demo data,
> **OFF** = not wired / key missing, **ERR** = source failed.

For the architecture and how to add your own layer, see `README.md`. For where the
project is headed, see `ROADMAP.md`.

---

## ✅ To-Do List (suggested build order)

Each step delivers a working improvement on its own.

- [ ] **1. Run the stack.** `npm install && npm run dev`. Confirm the globe loads and
      satellites, aircraft, seismic, events, conflict, and launches populate. The
      maritime layer runs in simulation until step 5. *No account needed.*
- [ ] **2. Register an OpenSky account** and create OAuth2 API-client credentials.
      Put them in `.env` → aircraft jump from ~400 to 4,000 pulls/day. The backend
      already does the token exchange (`server/opensky.js`); you just add the keys.
- [ ] **3. Build the ADS-B receiver** (the hardware part — full guide below). Two
      payoffs: feeding OpenSky ≥30% uptime unlocks **8,000 pulls/day**, and you get an
      **unlimited local feed** ARGUS can read directly.
- [ ] **4. Point ARGUS at your receiver.** Set `AIR.localFeed` in
      `web/src/config.js` to your tar1090 JSON URL → aircraft run with **no rate
      limit at all**.
- [ ] **5. Get a free aisstream.io key** → add it to `.env`, restart. Live maritime
      AIS replaces the simulation and the dark-ship detector works on real vessels.
      **Run `npm run verify-ais` first** to confirm the feed schema.
- [ ] **6. Get a free NASA FIRMS map key** → `FIRMS.MAP_KEY` in `web/src/config.js`,
      thermal/fire layer goes live.
- [ ] **7. Install Ollama** (optional) → local intel reports. Never required.
- [x] **8. ✅ GPS jamming is live** — the backend proxies gpsjam.org's daily
      interference data (`/api/gpsjam`, keyless). Nothing to configure.
- [ ] **9. Later:** power outages, internet outages, and X/social keyword+image
      search — layer modules and config slots are already stubbed and labeled.

**Where settings live now:** backend **secrets** (aisstream key, OpenSky
credentials, port) go in **`.env`**. Frontend **layer settings** (refresh rates,
`AIR.localFeed`, `FIRMS.MAP_KEY`, thresholds) go in **`web/src/config.js`**. There is
no longer a single HTML file to edit.

---

## Running ARGUS

Prerequisites: **Node.js 18+** (includes npm). That's it.

```bash
# from the repo root
npm install          # installs both workspaces (server + web)
cp .env.example .env # then edit .env to add any keys (optional)
npm run dev          # starts backend + frontend together
```

- Frontend: **http://localhost:5173**
- Backend:  **http://localhost:8787**  (health check: `/health`)

Run them separately if you prefer: `npm run dev:server` and `npm run dev:web`.
Run the tests any time with `npm test` (17 tests, no network needed — including a
captured-fixture schema lock for the AIS ingest path).

Build for production with `npm run build` (outputs `web/dist`). See *Deploying* at
the end.

### How CORS is handled now
The Vite dev server proxies `/api/*` and `/ws` to the backend (see
`web/vite.config.js`), so the frontend uses same-origin paths and there are no CORS
headaches. Feeds that the browser can call directly (USGS, NASA EONET/GIBS,
Open-Meteo, Launch Library, adsbdb, CelesTrak, Esri tiles) do so; anything needing
a secret, a persistent socket, or server-side processing (OpenSky OAuth2, live AIS,
GDELT bulk-event ingestion, gpsjam H3 decoding) goes through the backend.

---

## The ADS-B Receiver (Step 3)

Goal: receive 1090 MHz ADS-B locally, **feed OpenSky** (to unlock 8,000 credits/day),
and expose a **local JSON feed** for ARGUS.

### Hardware (~$40–70)
- Raspberry Pi (3/4/5, or a Zero 2 W for a minimal build) + SD card + power.
- **RTL-SDR dongle** — get a 1090 MHz / ADS-B kit (e.g. RTL-SDR Blog v3/v4).
- **1090 MHz antenna** — the kit antenna works; a proper 1090 antenna with a
  window/roof mount dramatically increases range.
- Optional: a 1090 MHz LNA/filter for weak-signal areas.

### Easiest path — the adsb.im image
1. Flash the **adsb.im** image to your SD card (their site has a how-to + video).
2. Boot the Pi, open its web interface on your LAN.
3. Set your antenna **latitude/longitude/altitude** and configure the RTL-SDR for
   1090 MHz.
4. Go to the **Feeder** section → enable OpenSky.
   - **Account name** = your **OpenSky username** (from your Account page) — *not*
     the API client ID.
   - **Serial number**: click **Request Serial** to get one from OpenSky. Wait for
     confirmation before reloading. Never enter a placeholder like `0`/`123456`.
   - Click **Apply**.
5. Your sensor appears under **My Sensors** on your OpenSky account.

### Docker path (if you already run tar1090/ultrafeeder)
Add the OpenSky feeder alongside ultrafeeder:
```yaml
# append inside services: in your docker-compose.yml
  opensky:
    image: ghcr.io/sdr-enthusiasts/docker-opensky-network:latest
    container_name: opensky
    restart: unless-stopped
    environment:
      - BEASTHOST=ultrafeeder        # pull ADS-B from the ultrafeeder container
      - LAT=${FEEDER_LAT}
      - LONG=${FEEDER_LONG}
      - ALT=${FEEDER_ALT_M}
      - OPENSKY_USERNAME=your_opensky_username
      - OPENSKY_SERIAL=your_serial   # set this or a NEW serial is made each restart!
```
First run without `OPENSKY_SERIAL` prints an allocated serial in the logs — copy it
back into the compose file so it stays stable. Check what you're feeding at
`opensky-network.org/receiver-profile`.

### Unlocking the higher tier
- "Active contributor" = your receiver is online **≥30% of the current month**.
- That raises your allowance to roughly **8,000 credits/day**.
- Feeder status is recalculated about every 2 hours; a tier change takes effect
  after ~50 requests. Confirm via the backend: `curl http://localhost:8787/health`
  (once you add OpenSky creds), or watch `X-Rate-Limit-Remaining` on OpenSky.
- Reminder on cost: `/states/all` credit cost scales with bounding-box **area**
  (lat-range × lon-range), which is exactly why **Region Focus mode** is cheap —
  use it to stretch your budget.

### The local feed (Step 4) — no rate limits at all
Feeder images that run **tar1090/readsb/dump1090** expose a live JSON of everything
your antenna sees, usually at:
```
http://<pi-ip>:8080/data/aircraft.json
```
Point ARGUS at it in **`web/src/config.js`**:
```js
AIR: {
  // …
  localFeed: "http://192.168.1.50:8080/data/aircraft.json",
}
```
The aircraft layer then plots **your** receiver's traffic directly — unlimited, and
it includes some aircraft the aggregators filter. (If the Pi is on a different host,
you may need to allow CORS on the tar1090 side, or add a passthrough route to the
backend.)

---

## OpenSky OAuth2 (Step 2) — already wired

OpenSky retired username/password auth (March 2026) — it's **OAuth2 client
credentials** now. **The backend already handles the token exchange, caching, and
refresh** (`server/opensky.js`); you don't write any proxy code. Just supply
credentials:

1. Log in → OpenSky Account page → create an **API client** → copy `client_id` and
   `client_secret`.
2. Put them in **`.env`**:
   ```
   OPENSKY_ID=your_client_id
   OPENSKY_SECRET=your_client_secret
   ```
3. Restart (`npm run dev`). The frontend already calls `/api/opensky`; the backend
   attaches the bearer token server-side, so the secret never reaches the browser.

Falls back to the anonymous tier automatically if the credentials are absent.

---

## Maritime AIS (Step 5) — aisstream.io

The live AIS pipeline is **already built** end-to-end: `server/ais.js` holds the
websocket to aisstream, dedupes vessels, and runs dark-ship detection with the
`server/ports.js` false-positive filter; `web/src/layers/sea.js` renders it. You just
provide a key.

1. Go to **aisstream.io**, sign in (GitHub), copy your free API key.
2. Put it in **`.env`**:
   ```
   AISSTREAM_KEY=your_key_here
   ```
3. **Verify the feed schema first:**
   ```bash
   npm run verify-ais
   ```
   This connects, captures real messages, and confirms the fields `server/ais.js`
   reads still exist. If aisstream changed their schema, it tells you exactly which
   path to fix.
4. Restart (`npm run dev`). The relay connects, the SEA/DARK layers switch from
   `sim` (amber) to `ok` (green), and the dark-ship detector runs on real vessels.
   If the backend or key is absent, the frontend simulation transparently takes over.

**Which waters it watches** and the **dark-ship thresholds** live in
`server/config.js` (the `ais` block: `boxes`, `underwaySog`, `darkThresholdMin`, …).
The default subscription is now **global** (8 quadrant boxes — tens of thousands of
vessels); a lighter chokepoint preset (Hormuz, Suez, Malacca, Taiwan Strait, …) is
commented right below it. Dark-ship false positives are suppressed against the
**NGA World Port Index** (~2,900 ports, shipped in `server/data/wpi.json`) plus a
curated chokepoint seed list.

**Coverage caveat:** aisstream's free feed is volunteer *terrestrial* receivers.
Regions without active receivers deliver nothing regardless of your boxes — the
Persian Gulf / India sector has been observed dark. True global coverage requires
paid satellite AIS: **Spire, exactEarth, MarineTraffic, Datalastic**. **AISHub** is
free if you contribute your own AIS receiver.

---

## NASA FIRMS thermal/fire (Step 6)

1. Request a free **MAP_KEY** at `firms.modaps.eosdis.nasa.gov` (API section).
2. Set `FIRMS.MAP_KEY` in **`web/src/config.js`**. The layer enables itself.
3. Source options: `VIIRS_SNPP_NRT` (default), `VIIRS_NOAA20_NRT`, `MODIS_NRT`.
   Region Focus automatically narrows the query box to save quota.

Catches wildfires, industrial fires, flares, and large explosions/strikes as
thermal anomalies. (This key is read in the browser; if you'd rather hide it, add a
`/api/firms` passthrough to the backend the same way OpenSky is proxied.)

---

## Local LLM intel reports (Step 7, optional)

Never a dependency — the **⌁ Generate Intel Report** button degrades to setup
instructions if no model answers. The **backend proxies Ollama** (`/api/llm`),
so there's **no browser CORS config** — you don't need `OLLAMA_ORIGINS`. The
report **streams** into the panel token-by-token, and the SITREP is built from
the full live picture (military air, dark ships, GPS-denied zones, conflict
clusters, large fires, seismic, launches, and any alert with cross-layer
correlation).

1. Install **Ollama** → https://ollama.com/download (the installer auto-starts
   the local server on `127.0.0.1:11434`).
2. Pull the model: `ollama pull llama3.1:8b`
3. Make sure it's serving (`ollama serve` if the installer didn't).
4. Start/restart the ARGUS backend, then click **⌁ Generate Intel Report**.

Pick a different model with **`OLLAMA_MODEL`** in `.env` (e.g. `llama3.2:3b`
for speed, `qwen2.5:14b` for stronger analysis) — it's a backend setting now,
not a frontend one. Point at a non-default host/port with **`OLLAMA_URL`**.
`/health` reports the configured model and whether a report has succeeded.

Hardware: an 8B model at 4-bit needs ~6 GB RAM (CPU works, ~20–60 s/report; any
8 GB GPU or Apple Silicon is near-instant).

---

## Keyless layers already live (no action needed)

| Layer | Source | Notes |
|---|---|---|
| Satellites | CelesTrak TLE + SGP4 | full `active` catalog (cap 1,500), propagated client-side every 2 s; TLEs cached in localStorage against CelesTrak's 2 h re-download throttle |
| Aircraft | OpenSky (anon) | limited until Steps 2–4 |
| Seismic | USGS | 24 h feed, feeds the alert engine + magnitude filter slider |
| Weather/Events | NASA EONET + Open-Meteo | click the globe for point weather |
| Conflict/News | GDELT 2.0 bulk events (via backend `/api/conflict`) | rolling 24 h of protest/coercion/assault/fighting events clustered to 0.5° — the old GDELT GEO JSON API is dead |
| GPS Jamming | gpsjam.org (via backend `/api/gpsjam`) | daily interference derived from ADS-B Exchange; default >10% bad fixes (`JAMMING.minPct`), dense fields merged into ringed GPS-denied zones |
| Airports | OurAirports CSV + aviationweather.gov (via backend `/api/avwx`) | large/medium fields; click for decoded METAR/TAF, wind rose, and a runway diagram with the into-wind runways highlighted |
| Cities | Natural Earth populated places | toggleable cartography layer (default off), top 500 by population, labeled |
| Military Air | adsb.lol `/v2/mil` (via backend `/api/milair`) | global military aircraft (~250), magenta arrows, dossier/path on click |
| Bike Share | curated GBFS systems (via backend `/api/bikeshare`) | ~10k stations across major cities w/ live bikes/docks; **default-off, lazy** (loads on enable) |
| Weather Radar | RainViewer (`⛆ RADAR` header toggle) | global animated precipitation mosaic (fuses US NEXRAD + worldwide radar); ~2 h loop |
| Launches | Launch Library 2 (dev endpoint) | plotted at the pad; no-rate-limit endpoint |
| Dossiers | adsbdb | click any aircraft → type/owner/route/photo |
| Imagery | NASA GIBS + Esri World Imagery | 🛰 IMAGERY cycles OFF → HD (8K Blue Marble) → LIVE (daily MODIS); zooming below ~2,200 km drapes Esri/Maxar tiles under the camera down to building scale |

**Launch Library note:** the live tier is 15 calls/hour, so ARGUS uses the
no-rate-limit **dev** endpoint (data lags slightly — fine for a schedule). For a big
deployment, get a key and cache server-side rather than hitting them per client.

---

## Config quick reference

Two files, clear split:

**`.env`** (backend secrets — gitignored):

| Key | Purpose |
|---|---|
| `BACKEND_PORT` | backend port (default 8787; deliberately not `PORT`, which dev harnesses/PaaS hosts inject for the frontend) |
| `BACKEND_TOKEN` | optional shared auth token — set before exposing the backend beyond localhost (REST: `Authorization: Bearer`, WS: `/ws?token=`) |
| `OLLAMA_URL` / `OLLAMA_MODEL` | local LLM for intel reports (defaults `http://127.0.0.1:11434/api/generate`, `llama3.1:8b`) |
| `AISSTREAM_KEY` | live maritime AIS |
| `OPENSKY_ID` / `OPENSKY_SECRET` | OpenSky OAuth2 (higher aircraft limits) |
| `FIRMS_MAP_KEY` | NASA FIRMS thermal/fire (proxied via `/api/firms`) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Radar internet-outage annotations (Net Outages layer, `/api/outages`) |
| `WINDY_WEBCAMS_KEY` | Windy public webcams (CCTV layer, `/api/webcams`) |
| `MAPILLARY_ACCESS_TOKEN` / `MAPILLARY_CLIENT_SECRET` | Mapillary street-level imagery on surface-click |
| `GOOGLE_MAPS_KEY` | Google 2D/3D/Street View tiles (Phase D; client-side, restrict in Cloud Console) |

**`web/src/config.js`** (frontend layer settings):

| Key | Purpose |
|---|---|
| `AIR.localFeed` | your receiver's tar1090 JSON → unlimited aircraft |
| `AIR.url` | aircraft source (defaults to the backend `/api/opensky` proxy) |
| `SEA.wsUrl` / `SEA.snapUrl` | backend AIS relay endpoints (defaults are fine) |
| `FIRMS.MAP_KEY` | NASA thermal/fire |
| `FIRMS.minFrp` / `minBright` | realistic-fire cut (default FRP ≥ 10 MW — the raw feed is every warm pixel on Earth) |
| `JAMMING.url` | GPS interference source (default: backend `/api/gpsjam` proxy of gpsjam.org) |
| `JAMMING.minPct` / `minAircraft` | interference threshold (default >10% bad fixes from ≥10 aircraft — the deliberate-jamming band) |
| `CONFLICT.url` | conflict clusters (default: backend `/api/conflict` GDELT ingester) |
| `QUAKE.minMag` | earthquake magnitude filter floor (default 4.5; also a UI slider) |
| `AIRPORTS.*` / `CITIES.*` / `BORDERS.*` | OurAirports catalog + runways, Natural Earth places + admin-0 sources |
| `MILAIR.url` / `BIKE.url` | military-air + bike-share backend proxy endpoints (defaults fine) |
| `DVR.cadenceMs` / `retainHours` | scrubber DVR recording cadence + default look-back window (UI-adjustable ≤ 48 h) |
| `LLM.endpoint` | intel-report endpoint (default `/api/llm` — the backend's Ollama proxy) |
| `ALERTS.quakeMag` / `ALERTS.notify` | alert thresholds + browser notifications |
| `ARCHIVE.enabled` | persist history to IndexedDB for the time scrubber |

**`server/config.js`** (backend AIS tuning): chokepoint `boxes`, `underwaySog`,
`darkThresholdMin`, `minReportsBeforeDark`, broadcast/scan intervals, memory guards.

---

## Operator UI quick reference

- **Search** (header): name / MMSI / callsign / ICAO hex across vessels, aircraft,
  airports, satellites — Enter flies to the first match and opens its detail.
- **Click** a contact: detail panel + full path (aircraft also get an
  altitude/ground-speed **flight profile** panel). **Double-click**: orbit-focus the
  object — drag swivels around its vertical axis; double-click empty space releases.
- **Camera**: left-drag rotates the globe, scroll zooms. Zoomed in (< ~380 km),
  **right-drag frees the camera** — tilt toward the horizon and rotate to see
  buildings in 3D; left-drag then pans the ground. Scroll back out to return to the
  top-down map view.
- **Click the bare globe**: surface weather with a wind compass rose.
- **Click an alert**: dives the camera to max zoom on the event location.
- **Sidebar**: each layer row's colour+icon chip opens a **style menu** (colour
  picker, icon picker — `➤` is heading-oriented arrows for aircraft/military/ships —
  and a per-layer size slider). Plus LIVE/SIM/OFF/ERR badge, count; quake-magnitude
  slider; **contact filters** (flag state / MIL-CIV / NOTABLE watchlist / underway-only /
  aircraft altitude band / satellite orbit band); NAMES toggle for nation labels.
- **Movers**: aircraft, ships, and satellites leave a short fading **ghost trail**
  (always on). `⛆ RADAR` in the header toggles the animated global precip overlay.
  `⌂ 3D` toggles building extrusions — zoom below ~30 km over a city (OSM
  Buildings data; swap `BUILDINGS.key` in `web/src/config.js` if rate-limited).
- **Filters row 2**: **UNDERWAY** hides anchored/moored vessels and
  near-stationary targets; **ALT** bands aircraft (<10k / 10–30k / >30k ft);
  **ORBIT** bands satellites (LEO / MEO / GEO).
- **Panels**: drag a panel's title bar to move it; click the title to collapse it.
- **Alerts**: click to locate, ✓ acknowledge (✓ ALL in the header), ✕ delete.
- **Timebar**: 4D scrubber spans the **DVR** window (default 4 h, up to 48 h,
  1-min frames in IndexedDB); **📷 SNAPSHOT** exports the global picture as JSON.
- **Header health strip**: tracked vessels · dark flagged⚑/suppressed⌀ · STS
  alerts · OpenSky auth · DB status, refreshed from `/health` every 30 s.

---

## Still stubbed (Step 9 — layer modules + slots ready)

Each is a real layer module in `web/src/layers/` that appears in the sidebar with a
status dot but isn't wired to a source yet:

- **Power outages** (`stubs.js` → OUTAGE) — PowerOutage.us (paid) or EIA-930 grid data.
- **Internet outages** (`stubs.js` → INTERNET) — IODA API or Cloudflare Radar (token +
  a backend passthrough for CORS).
- **X / social keyword + image search** (`stubs.js` → SOCINT) — X API v2 recent search
  via a backend route (`/2/tweets/search/recent`); geotag results into the SOCINT
  layer and render media in the SOCINT panel. Browsers can't call X directly — route
  through the backend with the bearer token server-side.

Implementing one means fetching the data and calling
`ctx.setLayerData("<ID>", positions, meta)` — see the "Adding a new layer" section in
`README.md` and any existing module (e.g. `seismic.js`) as a template.

---

## Deploying

Behind one reverse proxy (nginx/Caddy): serve the built `web/dist` statically and
route `/api/*` and `/ws` to the Node backend (`npm run start` in `server/`). Because
dev already uses those same paths via the Vite proxy, nothing changes between dev and
prod. A Docker Compose one-liner is on the roadmap.
