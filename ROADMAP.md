# SENTINEL — Reassessment & Roadmap

A candid look at where the project stands after the maritime build, what's solid,
what's fragile, and what to build next in priority order.

---

## Where it stands (v0.4)

**Architecture is now right for the problem.** The move from one HTML file to a
backend + frontend monorepo was the correct call: live AIS needs a persistent
server-side websocket, secrets need to live server-side, and dark-ship detection
needs stateful memory. All three now have a proper home.

**What's genuinely solid:**
- The backend is small, dependency-light (`ws` + `dotenv`), and cleanly separated:
  AIS relay, ports index, OpenSky proxy, and HTTP/WS server are independent modules.
- The dark-ship engine does real work: dedup, underway-then-silent detection,
  resurface tracking with jump distance, and now port-based false-positive
  suppression. The decision logic is unit-tested in isolation.
- The frontend maritime client is a pure module (no THREE/DOM), so it's reusable
  and testable.
- Config and geo helpers are extracted into their own modules, so `main.js` is now
  an orchestrator rather than a monolith.

**What's still fragile (known debt):**
1. **✅ RESOLVED — `main.js` monolith.** Layers are now separate modules behind a
   registry; `main.js` is a 595-line host. Adding a layer no longer touches the core.
2. **✅ RESOLVED — no automated tests.** 17 tests now run via `npm test` (backend
   logic + AIS-ingest schema fixture + frontend registry).
3. **✅ RESOLVED in practice — live AIS verified.** The relay runs against the real
   aisstream feed (global subscription, 15k+ vessels tracked). Known upstream
   limitation: aisstream is volunteer terrestrial receivers, so sectors without
   receivers (observed: Persian Gulf / India) deliver nothing — paid satellite AIS
   is the only real fix. `npm run verify-ais` remains useful for schema drift.
4. **Single backend process, in-memory state.** Fine for one operator. If the
   process restarts, dark-ship history resets. Persistence (below) fixes this.
5. **No auth on the backend.** Anyone who can reach the port gets the feed. Fine on
   localhost; needs a token before you expose it.

---

## Roadmap (priority order)

### Tier 1 — do these next (high value, low risk)

**1. ✅ DONE — Finish modularizing `main.js`.**
Each layer now lives in `web/src/layers/<name>.js` behind a common interface. A
layer module exports `{ id, name, color, load(ctx), … }` and optional hooks
(`init`, `tick`, `onScrub`, `onRegion`, `onVisible`, `companions`). `main.js` is now
a ~595-line host (globe + UI + timeline + alerts) that loads layers through the
`LayerRegistry`; the core no longer changes when you add a layer. See "Adding a new
layer" in the README.

**2. ✅ DONE — Real test suite.**
`server/logic.test.js` (ports + dark-ship state machine) and `web/registry.test.js`
(context/registry data-flow, including the scrub-freeze behavior), plus a captured
live-feed fixture through the real `_ingest`. 17 tests total, `npm test`.

**3. ✅ DONE — `verify-ais` run and schema locked.**
Verified against the live feed 2026-07-09 (all field paths ✓). A captured
PositionReport now lives in `server/fixtures/` and runs through the real
`_ingest` in `logic.test.js`, so schema drift fails the offline test suite.

### Tier 2 — persistence & robustness

**4. ✅ DONE — Persist AIS + alert history (SQLite).**
`server/db.js` (better-sqlite3, WAL): vessel breadcrumb fixes (48 h rolling) and
alerts (30 d) survive restarts; `/ais/track` transparently serves the longer
persisted track. Loaded dynamically — the server still runs if the native module
is missing. The frontend additionally has a browser-side **DVR** (IndexedDB,
1-min frames, ≤48 h) behind the 4D scrubber.

**5. ✅ DONE — Backend auth.**
Optional `BACKEND_TOKEN` env var: REST requires `Authorization: Bearer` (or
`?token=`), the WS handshake requires `/ws?token=`. Empty = open (localhost).
Per-IP rate caps remain TODO if ever exposed publicly.

**6. ✅ DONE — Health/metrics strip.**
Header strip polls `/health` every 30 s: tracked vessels, dark flagged vs
suppressed, STS alerts, OpenSky auth, DB status.

### Tier 3 — analytic depth (the "intelligence" in OSINT)

**7. ✅ DONE — Ship-to-ship (STS) transfer detection.**
`server/analytics.js`: grid-bucketed scan every 5 min for pairs with SOG ≤ 0.8 kt,
≤ 500 m apart, away from any port/anchorage, sustained ≥ 25 min → `STS TRANSFER
CANDIDATE` alert with separation and hold time. Stats surface in `/health`.

**8. ✅ DONE — Cross-layer correlation.**
Every maritime alert (dark / resurface / STS) is enriched server-side before
broadcast: inside/near a GPS-denied zone? conflict clusters within 250 km? The
context rides on the alert (`⚠ …` suffix in the UI). Feeding correlated events to
the local-LLM SITREP is the natural next step.

**9. Loitering & route-anomaly detection.** *(remaining)*
Deferred deliberately: without shore-distance/anchorage-area data beyond the port
index, a loiter detector false-positives on every roads anchorage. Needs either
OSM anchorage polygons or a learned lane baseline first.

**10. ✅ DONE — GPS jamming is live, with denied-zone clustering.**
The backend proxies gpsjam.org's daily H3 interference data (`server/gpsjam.js` →
`/api/gpsjam`), decoding hex cells to centroids. Default cut is the *high* band
(>10% bad fixes from ≥10 aircraft — the deliberate-jamming signature; tune with
`JAMMING.minPct`/`minAircraft` or `?minPct=` on the endpoint). Dense fields
(Baltic, Hormuz, Black Sea…) are merged into **GPS-DENIED ZONES** rendered as
rings with centroid stats. Deriving zones from *our own* OpenSky pulls in real
time remains a possible upgrade for intra-day latency.

### Tier 4 — packaging & reach

**11. Desktop app via Tauri.**
Wrap `web/` in a Tauri shell (~10 MB, Rust) with the Node backend as a sidecar, for
a true "runs locally on a machine" installer without shipping Chromium. Do this once
the layer architecture (Tier 1) is stable.

**12. Docker Compose one-liner.**
`docker compose up` bringing up backend + a static nginx for the built frontend, so
anyone can run the whole stack without a Node toolchain.

**13. Recorded-scenario mode.**
Replay a saved capture (from the SQLite archive) so you can demo or analyze a past
event offline — and so contributors can develop without live keys.

---

## Shipped since v0.4 (2026-07-08 session)

- **Global AIS** (8-quadrant subscription, 100k vessel cap) + **NGA World Port
  Index** (~2,900 ports) backing dark-ship suppression.
- **Conflict layer rebuilt** on GDELT 2.0 bulk events (`server/gdelt.js`) after the
  GEO JSON API died — rolling 24 h, CAMEO conflict classes, 0.5° clusters.
- **GPS jamming live** via gpsjam.org proxy (`server/gpsjam.js`).
- **Deep zoom to building scale**: Esri World Imagery tiles draped under the camera
  (`web/src/tiles.js`), altitude-scaled controls, dynamic near-plane.
- **HD basemap modes**: 8K Blue Marble / 4K daily MODIS with anisotropy + sRGB.
- **Region Focus filtering**: all layers clipped to the bbox; satellites kept by
  line-of-sight; instant re-filter from cached frames.
- **Full `active` satellite catalog** (cap 1,500) with localStorage TLE cache and
  fallback group against CelesTrak's 2 h download throttle.
- **Data-provenance badges** (LIVE/SIM/OFF/ERR) on every layer + legend.
- **Per-layer color pickers** (persisted), **quake magnitude slider**,
  **click-to-locate alerts**.
- **OpenSky OAuth2 + FIRMS keys wired**; backend port renamed `BACKEND_PORT` (the
  generic `PORT` gets hijacked by dev harnesses/PaaS for the frontend).
- **GPS-denied zones**: jamming defaults to the malicious band (>10% bad fixes,
  ≥10 aircraft) and clusters cell fields into ringed zones with radius/stats.
- **Contact paths on click**: aircraft get their full flight track (OpenSky
  `/api/opensky/track`) plus an altitude/ground-speed **flight profile panel**;
  vessels get breadcrumb history from the relay (`/api/ais/track`, 5-min fixes).
- **Airports layer** (OurAirports large/medium) with **decoded METAR/TAF** per
  field via `/api/avwx` (aviationweather.gov proxy) and a wind compass rose.
- **Surface weather visuals**: wind rose + plain-English WMO conditions on
  surface-point clicks.
- **Double-click orbit focus**: swivel the camera around any picked object;
  double-click empty space to release.
- **Parallax fix**: all ground-origin layers, coastlines and graticule now hug
  the surface (≤ ~5 km equivalent) instead of floating 20–45 km up.

## QOL backlog — ✅ shipped 2026-07-09

- ✅ **Layer icons** — per-layer sprite picker (● ▲ ▼ ■ ◆ ✚ ✈ ⚓ ⚠), persisted;
  aircraft/ships/dark default to ✈ / ⚓ / ⚠.
- ✅ **In-layer filters** — flag state (ITU MID for vessels, ICAO24 hex blocks for
  aircraft), military vs civilian (ship type 35 + naval prefixes; US-mil hex block
  + military callsigns), NOTABLE watchlist (`web/src/contactFilters.js`).
- ✅ **Contact search bar** — name/MMSI/callsign/hex across SEA/DARK/AIR/APT/SAT;
  flies to the first match and opens its detail panel.
- ✅ **Cartography** — Natural Earth 50m full-res borders (old decimated crossing
  LineLoops replaced), nation-name labels at cartographic label points (NAMES
  toggle), Cities layer (NE populated places, default-off, labeled top 150).
  Roads intentionally NOT vector — the deep-zoom Esri imagery carries them.
- ✅ **Thermal context** — FIRMS detections carry FRP → plain-English fire scale
  (small burn / 1–10 acres / 10–100 / major / extreme) + brightness context, and
  the layer now defaults to a realistic cut (FRP ≥ 10 MW).
- ✅ **Alert management** — per-alert ✓ acknowledge (dims, count tracks unacked)
  and ✕ delete; ✓ ALL in the panel header.
- ✅ **Snapshot DVR** — 1-min frames to IndexedDB (≤48 h); the 4D scrubber spans
  the DVR window (falls back to DVR frames past the ~50-min fine buffer); 📷
  SNAPSHOT exports the full global picture as JSON. Server-side SQLite (Tier 2 #4)
  is the durable substrate for vessel tracks.

## New data sources — ✅ shipped 2026-07-10 (Phase A)

- ✅ **Ghost trails** — short fading breadcrumb behind every aircraft / ship /
  satellite, always on regardless of focus. Shared `web/src/markers.js`
  (`TrailSet`); satellites accumulate their SGP4 subpoints, ships/aircraft their
  plotted positions; scrub-guarded so the 4D scrubber can't poison live history.
- ✅ **Directional arrow markers** — heading-oriented chevrons (InstancedMesh,
  tangent to the sphere) for aircraft/military/ships, with instance-id picking;
  toggled via the icon picker (`➤`). Non-oriented layers keep point sprites.
- ✅ **Military aircraft** — adsb.lol `/v2/mil` via backend proxy (CORS-blocked
  in-browser); global, keyless, ~250 aircraft, magenta arrows + dossier/path on
  click (`web/src/layers/milair.js`, `/api/milair`).
- ✅ **Bike share (GBFS)** — `server/bikeshare.js` resolves ~12 curated dock-based
  systems from the MobilityData catalog and merges station_information +
  station_status server-side (~10k stations, live bikes/docks). Lazy default-off
  layer (`/api/bikeshare`); framework gained a `lazy` flag so heavy layers load
  only on first enable.
- ✅ **Global weather radar** — `web/src/radar.js`: RainViewer mercator tiles
  assembled into a global overlay shell, animated through past + nowcast frames
  (`⛆ RADAR` header toggle). RainViewer's mosaic already includes US NEXRAD, so
  this is the "NEXRAD + worldwide" surveillance ask in one keyless source.

## Phase D — ✅ shipped 2026-07-10

- ✅ **3D buildings at deep zoom** — `web/src/buildings.js`: OSM Buildings z15
  GeoJSON footprints (height/levels attributes) extruded into ONE merged prism
  geometry per tile (walls + ShapeUtils-triangulated roofs — one draw call per
  tile) on the local tangent plane, activating below ~32 km altitude around the
  camera ground point. Lambert-shaded via a HemisphereLight that Basic-material
  layers ignore. `⌂ 3D` header toggle. **Google 3D Tiles upgrade seam**: the
  class's `update()/setEnabled()` interface is the boundary — swap the provider
  guts for 3d-tiles-renderer + a Maps key, nothing outside the file changes.
- ✅ **Arrows scale with zoom** — chevron matrices re-scale live (throttled,
  >12% delta) as the camera moves instead of waiting for the next data refresh.
- ✅ **Clutter filters v2** — UNDERWAY (hides anchored/moored vessels + slow
  targets), aircraft altitude band (<10k / 10–30k / >30k ft), satellite orbit
  band (LEO/MEO/GEO). Contact filtering now also covers MILAIR + SAT.
- ✅ **Optimization pass** — lazy detail-row construction for vessel metas
  (10k+ × 2 Hz of string formatting eliminated), trail rebuild throttling +
  minimum-movement threshold (anchored-vessel jitter no longer accumulates
  segments), reusable temp matrices in the plot loop.

## Phase B / C — planned (not yet built)

- **Phase B — CCTV mesh + street-level** (needs two free keys): Windy Webcams API
  for global public webcams + Mapillary open street-level imagery on click.
- **Phase C — OSM traffic**: *shelved* by decision.

## Suggested next steps

1. **Phase B (CCTV + Mapillary)** once the two free keys are in hand.
2. **Loitering detection (Tier 3 #9)** once anchorage polygons are sourced.
3. **Feed correlated events into the LLM SITREP** — context exists on every
   maritime alert; the report prompt doesn't use it yet.
4. **Per-IP rate caps** + **Tier 4 packaging** (Tauri, Docker, scenario replay).
5. **Google Photorealistic 3D Tiles** — drop-in provider swap in
   `web/src/buildings.js` when a Maps Platform key (billing) is available.

## Filter backlog (brainstormed 2026-07-10, not yet built)

- **Vessel class** — AIS ship-type groups (tanker 80s / cargo 70s / passenger
  60s / fishing 30 / tug / HSC / military 35); data already on `meta.shipType`.
- **Aircraft category** — readsb `category` (A1 light … A5 heavy, B4 glider,
  rotorcraft) on the adsb.lol feed; "heavies only" or "rotorcraft only" cuts.
- **Emergency only** — squawk 7500/7600/7700 across AIR + MILAIR.
- **Speed band** — supersonic/fast-mover cut (>600 kt) for intercept watching.
- **Density cap** — "top N by relevance in view" (closest-to-camera or
  biggest/fastest) instead of hard layer toggles when zoomed out.
- **Dark-duration** — only dark ships silent > N hours (staleness slider).
- **Constellation** — satellite owner/constellation grouping (Starlink,
  GLONASS, GPS, military) from the TLE name prefix.
- **Route stage** — climbing/descending/cruise via vertical-rate sign.
- **Watchlist v2** — per-entry colour + alert-on-appear (watchlist contact
  enters the plot → alert engine event).
