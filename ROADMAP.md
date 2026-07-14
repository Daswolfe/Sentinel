# ARGUS — Roadmap & Strategy

An open-source 4D geospatial command center: one Three.js globe fusing live
satellites, aircraft (civil + military), maritime AIS with dark-ship detection,
seismic, conflict, GPS-jamming, thermal, launches, airports, cities, and bike
share — with deep-zoom imagery + 3D buildings, weather radar, a 4D time
scrubber, an alert engine, and a local-LLM intel report.

**Repo:** github.com/Daswolfe/Argus (private) · **Last updated:** 2026-07-10

---

## 1. Where it stands

The single-file prototype is long gone. ARGUS is a small monorepo — a
no-framework Node backend (AIS relay, dark-ship engine, analytics, a dozen
data proxies, optional SQLite) and a Vite + vanilla-Three.js frontend where
every data source is a self-contained layer module behind a registry. Adding a
layer never touches the core.

**Solid foundations**
- **Layer architecture** — one file per source (`web/src/layers/*`); the host
  (`main.js`) provides globe, UI, picking, timeline, alerts, filters. New layer
  = write a module, register it.
- **Backend separation** — AIS relay, ports index, analytics, and each upstream
  proxy are independent modules; secrets stay server-side.
- **Tested** — 17 tests (`npm test`): dark-ship state machine, ports, a captured
  live-AIS fixture through the real ingest path, and the frontend registry.
- **Live-verified** — real aisstream feed (global, 15k+ vessels), OpenSky OAuth2,
  and every keyless feed confirmed in-browser.

**Known debt / limits**
- **Single backend process, mostly in-memory.** SQLite persists vessel tracks +
  alerts; the rest of the live picture is RAM. Fine for one operator.
- **No per-IP rate limiting.** A shared `BACKEND_TOKEN` gates access, but there's
  no connection cap — needed before any public exposure.
- **aisstream coverage gaps.** Volunteer terrestrial receivers, so receiver-poor
  sectors (Persian Gulf / India observed) deliver nothing. Only paid satellite
  AIS fixes it.
- **Screenshot/verify friction.** The WebGL canvas resists automated screenshot
  capture in the dev harness; verification is done via DOM/scene introspection.

---

## 2. Capabilities shipped

### Data layers
| Layer | Source | Notes |
|---|---|---|
| Satellites | CelesTrak `active` + SGP4 | client-side propagation, TLE cache, ghost trails |
| Aircraft | OpenSky (OAuth2 proxy) | flight path + alt/speed profile on click; oriented ✈ |
| Military Air | adsb.lol `/v2/mil` (proxy) | global, keyless, ~250; oriented ✈, dossier/path |
| Maritime AIS + Dark | aisstream relay | dark-ship + resurface + STS engine; oriented ➤; trails |
| Seismic | USGS | magnitude slider (default M≥4.5) |
| Weather/Events | NASA EONET + Open-Meteo | surface-click weather with wind rose |
| Conflict | GDELT 2.0 bulk events (proxy) | rolling 24 h, CAMEO classes, 0.5° clusters |
| GPS Jamming | gpsjam.org (proxy) | high-band cut, clustered into GPS-DENIED ZONES |
| Thermal/Fire | NASA FIRMS (proxy) | FRP → plain-English fire scale; realistic default cut |
| Launches | Launch Library 2 | plotted at pad; imminent-launch alerts |
| Airports | OurAirports + aviationweather (proxy) | decoded METAR/TAF, wind rose, runway diagram; ╳ symbol |
| Cities | Natural Earth | toggleable cartography, default-off, labeled |
| Bike Share | curated GBFS (proxy) | ~10k stations, live bikes/docks, lazy default-off |
| Weather Radar | RainViewer (`⛆ RADAR`) | global animated precip (incl. US NEXRAD) |
| Stubs | — | Power/Net outages, Social — labeled adapters, unwired |

### Backend & analytics
- **AIS relay + dark-ship engine** — dedup, underway→silent detection, resurface
  (dark-minutes + jump nm). False-positive suppression backed by ~17.7k
  anchorages/ports: NGA World Port Index (~2,900) **+ GFW named anchorages
  (~14,700, AIS-derived** from 166k S2 cells) + curated chokepoint seeds.
- **STS-transfer detection** (`analytics.js`) — stationary pairs ≤500 m, away
  from any anchorage, ≥25 min → alert.
- **Loitering detection** (`analytics.js`) — a single vessel stationary in open
  water (anchorage-filtered) ≥3 h → alert. The GFW anchorage index is what makes
  this precise.
- **Cross-layer correlation** — maritime alerts enriched server-side with nearby
  GPS-denied zones / conflict clusters before broadcast.
- **Proxies (keeps secrets + dodges CORS)** — OpenSky states/track, gpsjam,
  GDELT, aviationweather (avwx), adsb.lol mil, bikeshare, FIRMS, and Ollama LLM.
- **Persistence** — optional `better-sqlite3` (WAL): vessel fixes 48 h, alerts
  30 d, loaded dynamically. Frontend DVR (IndexedDB, 1-min frames ≤48 h) backs
  the 4D scrubber.
- **Auth** — optional `BACKEND_TOKEN` on REST + WS. **Health strip** polls
  `/health` (tracked, dark flagged/suppressed, STS, DB, LLM ready).

### Frontend / UX
- **Globe & camera** — deep-zoom Esri imagery tiles + OSM Buildings extrusions
  below ~30 km; **free-look** at deep zoom (right-drag tilt/rotate, screen-
  relative left-drag pan); double-click orbit-focus any object; alert click →
  dive to max zoom.
- **Markers** — ghost trails on all movers; heading-oriented **directional
  icons** (➤ chevron, ✈ plane, 🚁 heli as textured instances) + static sprites;
  per-layer **style menu** (colour + icon + size, persisted).
- **Filters** — flag state, mil/civ, NOTABLE watchlist, UNDERWAY, aircraft
  altitude band, satellite orbit band; **contact search** (name/MMSI/callsign/
  hex); quake-magnitude slider.
- **Time** — 4D scrubber + DVR; 📷 JSON snapshot export.
- **Alerts** — acknowledge / delete / locate; browser notifications.
- **Cartography** — Natural Earth full-res borders + zoom-scaled nation & city
  labels; LIVE/SIM/OFF/ERR provenance badges on every layer.
- **Intel report** — local **Ollama** SITREP, streamed token-by-token through
  the backend `/api/llm` proxy (no browser CORS config needed).

---

## 3. In progress / awaiting input

- **Phase B — CCTV + street-level** *(keys in hand — next up)*. Windy Webcams API
  (global public webcams) + Mapillary (open street-level imagery on click). Keys
  now provisioned in `.env`; ready to build.
- **Correlation → SITREP** ✅ *shipped 2026-07-11*. `buildSitrep()` now leads with
  a dedicated HIGH-SIGNAL & CROSS-LAYER-CORRELATED EVENTS section (dark/STS/
  loiter/resurface/emergency alerts + any '⚠'-marked event coinciding with a
  GPS-denied zone / conflict cluster), ahead of the force-laydown counts.
- **Loitering** ✅ *shipped 2026-07-11*. GFW named-anchorages CSV processed into
  `server/data/anchorages.json` (~14.7k) and merged into the port index; a
  single-vessel open-water loiter detector (≥3 h) now runs in `analytics.js`.
- **Route-anomaly** *(still blocked on lane baseline)*. Needs the learned density
  grid from the SQLite track archive, or EMODnet/MarineCadastre density rasters —
  loitering was the anchorage half; this is the lane half.

---

## 4. Known bugs

*All triaged bugs below fixed 2026-07-11.*

1. ✅ **FIXED — Deep-zoom pan rendered under the camera, not the look-at point.**
   `tiles.update()` / `buildings.update()` now derive their centre from the
   camera's look-at ground point (screen-centre ray → sphere, nadir fallback on a
   horizon/sky miss), so a tilted free-look view renders the scene ahead.
2. ✅ **FIXED — Alert click flew to the alert's birthplace.** Alerts now carry a
   `ref` ({icao}/{mmsi}); clicking re-resolves the contact's **live** position via
   `liveContactPos()` and dives there, falling back to the stored point if the
   contact is gone. Wired for emergency squawks (aircraft) and dark/STS/resurface
   (vessels).
3. ✅ **FIXED — Ship icons floated above the surface at max zoom.** SEA/DARK plot
   dropped from R+0.04 (~2.5 km) to R+0.0015 / R+0.002 (~100 m, just above the
   tile overlay) — they now hug the water at building zoom.
4. ✅ **FIXED — Inconsistent ADS-B altitude units.** Feet is now the canonical
   unit: internal `altFt` was already normalized; the OpenSky detail-panel display
   (previously metres) now reads feet like the adsb.lol / local-receiver paths.
   *(A global units settings panel — §5 Theme 4 — remains for user-selectable units.)*
5. ✅ **FIXED — A selected contact could not be unselected.** In object-orbit mode,
   **right-drag** now swivels around the contact and **left-drag deselects** it and
   returns to global pan/movement (double-click empty space still releases too).

---

## 5. Strategy from here

The tool is now broad. The strategic pivot is from *breadth* (more feeds) toward
**depth** (turning feeds into insight) and **reach** (making it runnable and
shareable now that it's on GitHub). Four themes, roughly in priority order.

### Theme 1 — Intelligence depth *(✅ COMPLETE — 2026-07-11/13)*
Raw dots are commodity; correlated insight is not. This is where ARGUS earns
the "S" in OSINT. **All items shipped:**
- ✅ **Correlation → LLM SITREP** — maritime alerts carry cross-layer context;
  the streamed SITREP (Ollama via `/api/llm`) leads with the highest-signal
  correlated events.
- ✅ **Watchlist v2** — per-entry colour, alert-on-appear, add-from-map.
- ✅ **Tracking boxes / tripwires** (`web/src/tripwires.js`) — draw a polygon,
  count entries/exits by class, running tallies, persisted.
- ✅ **Airspace tripwires** — build a tripwire from a nation's border polygons
  (multi-ring), tracks aircraft in/out of that airspace.
- ✅ **Surveillance-orbit detector** (`web/src/orbitwatch.js`) — winding-number
  test over aircraft track history (≥1.5 loops, bounded radius) → alert + orbit ring.
- ✅ **Loitering & route-anomaly** (`server/analytics.js`) — single-vessel loiter
  in open water, suppressed by the ~14.7k **GFW Named Anchorages** now in `ports.js`.
- ✅ **Dossier builder** (`web/src/dossiers.js`) — per-nation files auto-accrue
  from attributable alerts (flag state via MMSI MID / ICAO24 hex block), timeline
  panel, streamed LLM brief. The intelligence capstone.
- ✅ **Pattern-of-life queries** (`server/db.js` `queryAlerts`) — SQLite archive
  queryable by time / kind / bbox + kind histogram.

<details><summary>Original Theme 1 detail (for reference)</summary>

1. **Correlation into the LLM SITREP** — feed the already-computed cross-layer
   context (dark ship inside a jamming zone near a conflict cluster) to the
   report instead of counts. Cheap, immediate.
2. **Watchlist v2** — per-entry colour + **alert-on-appear** (a watchlist contact
   entering the plot fires an alert), and let the user **add a contact or an area
   to the watchlist directly from the map** (right-click / detail-panel action).
   Turns the passive watchlist active.
3. **Tracking boxes / tripwires** — let the user **draw a box or arbitrary
   polygon that counts entries and exits**, configurable for which classes to
   count (ships, military aircraft, …). E.g. "how many ships transited this gate
   of the Strait of Hormuz." Persisted, with running tallies + optional alerts on
   crossing. Reuse the same crossing logic for **nation-airspace in/out** using
   border polygons (§Theme 3, nation walls / boundaries share the geometry).
4. **Surveillance-orbit detection** — flag aircraft flying a **series of circles
   over one location** (ISR / holding-orbit signature): detect repeated heading
   sweep-through-360° with bounded ground track over a time window. Sibling to
   loitering; works on the track history we already store.
5. **Loitering & route-anomaly** — vessels deviating from lanes or loitering in
   open water. Highest-value maritime analytic after STS. Data sources (was the
   blocker; now chosen):
   - *Anchorage suppression (loitering):* **Global Fishing Watch "Named
     Anchorages"** — AIS-derived global anchorage points (~100k, named), free w/
     attribution + account. Drops into the existing `ports.js` grid-index exactly
     like the NGA WPI (points + radius). Sharpen key chokepoints with **OSM
     `seamark:type=anchorage`/`anchorage_area` polygons** via the **Overpass
     API**; **EMODnet Human Activities** anchorage/port polygons for EU waters.
   - *Lane baseline (route-anomaly):* **roll our own density grid** from the
     SQLite track archive we already persist (accumulate positions into ~1 km
     cells → lanes emerge) — architecturally free, needs calendar time. For
     instant coverage meanwhile, pull ready-made AIS density rasters: **EMODnet
     Human Activities Vessel Density** (EU, monthly, 2017+) and **MarineCadastre.gov**
     (NOAA/BOEM, US waters). Add **searoute** (Eurostat port-to-port routing) for
     the "declared vs. actual route" prior later.
   - *Verify licenses/endpoints before wiring* (GFW needs a free account +
     attribution; EMODnet has its own license; some URLs have moved over time).
6. **Dossier builder** — accrete a living **per-nation (and per-notable-entity)
   dossier** of notable events, movements, and locations over time (Iran, Russia,
   China, …), adding and aging out entries as appropriate. Feeds — and is fed by —
   the LLM SITREP and the watchlist. The strategic capstone of the intelligence
   theme.
7. **Pattern-of-life queries** — the SQLite archive already holds days of tracks;
   expose "every dark event in Hormuz this month"–style queries + a history panel.

</details>

### Theme 2 — New sensors *(✅ COMPLETE — 2026-07-11)*
- ✅ **Phase B: CCTV (Windy Webcams) + Mapillary street-level** — `layers/webcams.js`
  (public webcams via `/api/webcams`) + Mapillary imagery on surface-click, keys
  server-side.
- ✅ **Net Outages via Cloudflare Radar** — `layers/outages.js` + `/api/outages`
  proxy; internet-outage annotations placed at country centroids (reused from the
  borders layer), cause/scope/dates decoded. Retired the INTERNET stub.
- ⬜ **Remaining stubs** — Power Outages (PowerOutage.us paid / EIA-930) and
  X/social keyword search stay stubbed pending data/keys.

### Theme 3 — Fidelity, cartography & boundaries *(← ACTIVE)*
- ✅ **GPS-jamming shape fidelity** (#12 below) — DONE: `server/gpsjam.js` now
  returns a padded convex **hull** of each cluster's H3 cells; `layers/jamming.js`
  draws the hull polygon instead of a bounding circle.
- ✅ **Nation highlight walls** (#10 below) — DONE: `web/src/nationwalls.js`;
  click a nation's name label → translucent extruded border wall (fades with
  height) + bright base line, one merged mesh per nation, palette-coloured,
  multiple nations at once, persisted in localStorage and rebuilt on load.
  Click the name again to clear. Walls use ≤800-pt rings (render-only), kept
  separate from the ≤250-pt tripwire rings that go to localStorage.
- ✅ **Maritime boundaries** (#11 below) — DONE 2026-07-13 (maritime half):
  "Sea Boundaries" layer — EEZ / disputed / 24 nm / 12 nm from Marine Regions v12.
- ⏸ **Google 3D Tiles** (#13 below) — ATTEMPTED 2026-07-13, SHELVED. What
  works and is kept in-tree: three upgraded 0.160→0.185 + `3d-tiles-renderer`
  0.4.28; billing-gated key delivery (`/api/config` + `POST /api/tiles-session`
  — the backend meters ROOT tileset requests, the billable unit, against a
  persisted monthly cap of 900/1,000 free and refuses past it, token
  auto-refresh disabled so no request can bypass the meter); ECEF→display-
  sphere anchor transform (verified numerically exact incl. orientation);
  sessions stream with live Google attributions; Dallas rendered fully
  photorealistic once. UNRESOLVED: with a TilesRenderer active the main render
  pass intermittently collapses to a single draw call → black viewport at deep
  zoom (renderer.info showed 1 call/6k tris vs the normal ~28 calls). Needs an
  isolated repro. Shelved behind `CONFIG.BUILDINGS.provider = 'osm'` (flip to
  `'google'` to resume); OSM extrusions remain the active provider and were
  re-verified at deep zoom.
- ✅ **Filter polish** (#14) — DONE 2026-07-14: the §7 filter backlog shipped
  (vessel class, aircraft category, emergency-only, fast-mover, dark-duration,
  constellation, route stage) as two new sidebar filter rows. Only the density
  cap remains (deferred — needs cross-layer relevance scoring).
- **Theme 3 complete** except the shelved #13 (Google 3D Tiles render-pass
  conflict).

10. ✅ **Nation highlight walls** — **click a nation's name → highlight it with a
    translucent extruded wall along its borders** (reuse the Natural Earth border
    polygons already loaded for labels).
11. ✅ **Maritime & airspace boundaries** — DONE (maritime): Marine Regions v12
    preprocessed by `server/data/convert-maritime.mjs` (~250 MB WFS → 1.9 MB
    `maritime.json`), served at `/api/maritime`, drawn by `layers/boundaries.js`
    ("Sea Boundaries", lazy/default-off): EEZ delimitation blue, **disputed/
    unsettled red**, 24 nm violet, 12 nm teal — one LineSegments per class.
    National airspace polygons are covered by nation walls + airspace tripwires
    (shared Natural Earth rings); FIR boundaries stay in the backlog.
12. **GPS-jamming shape fidelity** — the affected area currently renders as a
    **bounding circle**; replace it with a **polygon / concave hull (or per-H3-cell
    footprint)** that traces the actual affected cells, so the shape depicts the
    real region.
13. **Google Photorealistic 3D Tiles** — the `buildings.js` provider seam is
    ready; drop in `3d-tiles-renderer` + a Maps Platform key (billing) for true
    photorealistic cities at deep zoom.
14. **Filter & marker polish** — work the filter backlog (§7) as clutter demands.

### Theme 4 — UX, packaging & reach *(← ACTIVE)*
15. ✅ **Global units settings panel** — DONE 2026-07-14: `web/src/units.js`
    (canonical internal units → display conversion) + ⚙ UNITS header popover
    (altitude ft/m/FL · speed kt/km·h⁻¹/mph · distance nm/km/mi · temp °C/°F ·
    coords DD/DMS), persisted; applied to AIR/MILAIR/SEA/DARK rows, surface
    weather, and METAR panels. Changes apply as each feed refreshes.
16. ⏸ **Contributor on-ramp** — SHELVED (per operator, 2026-07-14).
17. ✅ **Docker Compose one-liner** — DONE 2026-07-14: `docker compose up
    --build` → nginx on :8080 serving `web/dist` + proxying /api & /ws to the
    backend container (`docker/*.Dockerfile`, `docker/nginx.conf`,
    `docker-compose.yml`). Vite production build verified; container build
    itself not yet run (no Docker on the dev box).
18. ✅ **Per-IP rate limiting** — DONE 2026-07-14: sliding 1-min window per IP
    (default 300 req/min, `RATE_LIMIT_PER_MIN`, 0=off, /health exempt) + max
    concurrent websockets per IP (default 4, `WS_MAX_PER_IP`); `TRUST_PROXY=1`
    reads X-Forwarded-For behind a reverse proxy. Verified: burst of 310 →
    exactly 300×200 + 10×429.
19. **Tauri desktop app** — ~10 MB native shell, Node backend as sidecar.
20. ✅ **Recorded-scenario replay** — DONE 2026-07-14. Message-level NDJSON
    capture instead of the SQLite fixes (those are 5-min breadcrumbs with no
    name/sog/type — too lossy to drive the dark-ship engine): `AIS_RECORD=`
    taps the live feed to a file; `AIS_REPLAY=` plays it back through the real
    ingest path (dark/STS/loitering all run) with NO key needed, honouring
    recorded gaps ÷ `AIS_REPLAY_SPEED`, looping at EOF with a 2 s rewind +
    clean vessel table. `/health` reports `ais.mode: live|record|replay`; the
    health strip shows REPLAY. Bundled demo tape:
    `server/data/demo-scenario.ndjson` (Europe/Med box). Unit-tested.

### Recommended next 3 moves
1. **Tauri desktop app** (#19) — needs the Rust toolchain on the dev box.
2. **Density cap filter** (§7 leftover) — "top N by relevance in view".
3. **Diagnose the shelved Google 3D Tiles render-pass conflict** (#13) when
   convenient; user feature request §9.1 (dark-ship pulse ring) also open.

---

## 6. Known limitations to keep visible

- **FIRMS global daily** can return sparse/header-only responses under the free
  key's transaction limit; region-focused queries are more reliable.
- **Bike-share `bikes` field** is null for GBFS v3 vehicle-type systems (e.g.
  Buenos Aires); docks/capacity still populate.
- **Private repo** can't be *opened* by Mapillary/Windy reviewers — flip to
  public if a key request is rejected (repo is already scrubbed of secrets).

---

## 7. Backlog — filters & nice-to-haves

*Shipped 2026-07-14 (Theme 3.14):* ✅ vessel class (tanker/cargo/pax/fishing/
tug/military; selecting a class hides unknown-type targets), ✅ aircraft
category (light/large/heavy/hi-perf/rotor — adsb.lol `category` + OpenSky
`extended=true` enum; unknown passes), ✅ emergency-only (7500/7600/7700),
✅ fast-mover cut (>600 kt, unknown speed hidden), ✅ dark-duration (>1/3/6/12 h),
✅ constellation (Starlink/OneWeb/Iridium/GPS/GLONASS/Galileo/BeiDou by TLE
name), ✅ route stage (climb/cruise/descent, ±300 ft/min).

- **Density cap** — "top N by relevance in view" instead of hard toggles.
  (Deferred: needs a relevance score across layers.)

---

## 8. Changelog (high level)

- **2026-07-14 (later)** — **Theme 3 complete** (filter backlog shipped: ship
  class, aircraft category, emergency-only, fast-mover, dark-duration,
  constellation, route stage). **Theme 4**: global units panel (#15), Docker
  Compose one-liner (#17), per-IP rate limiting + WS cap (#18); contributor
  on-ramp (#16) shelved per operator. Remaining: Tauri (#19), replay (#20).
- **2026-07-14** — **Theme 3.11 shipped**: "Sea Boundaries" layer (EEZ /
  disputed / 24 nm / 12 nm, Marine Regions v12 → 1.9 MB preprocessed index,
  `/api/maritime`). **Theme 3.13 attempted & shelved**: Google Photorealistic
  3D Tiles behind a hard billing gate (backend-metered root requests, 900/mo
  cap — cannot exceed the free tier); registration + streaming verified but a
  deep-zoom render-pass conflict remains, so OSM extrusions stay the active
  provider (`CONFIG.BUILDINGS.provider`). three 0.160→0.185.
- **2026-07-13 (later)** — **Nation highlight walls** (Theme 3.10): click a
  nation's name label → translucent extruded border wall (`nationwalls.js`),
  palette-coloured, multi-nation, persisted; click again to clear. Live-verified
  (Chile/Saudi Arabia/Mongolia raised by clicking, Russia cleared, walls survive
  reload); 17/17 tests green.
- **2026-07-13** — **Theme 1 complete** (tracking boxes + airspace tripwires,
  surveillance-orbit detector, per-nation dossier builder w/ LLM briefs,
  pattern-of-life SQLite queries, watchlist v2, correlation→SITREP). **Theme 2
  complete** (Windy CCTV + Mapillary street-level; Net Outages via Cloudflare
  Radar). **Theme 3 started**: GPS-jamming zones now render the affected-cell
  **convex hull** instead of a bounding circle. Google/Windy/Mapillary/Cloudflare
  keys provisioned in `.env`. Debug hook gated behind `?debug`.
- **2026-07-11** — GFW named anchorages (~14.7k) integrated into the port index
  (dark-ship + STS suppression now far more accurate); single-vessel **loitering
  detection** (≥3 h open-water) added to `analytics.js`; health strip shows LTR.
- **2026-07-11** — fixed all 5 triaged bugs: deep-zoom look-at rendering, alert
  fly-to-live-position, floating ship icons, ADS-B unit normalization (feet), and
  contact select/deselect (right-drag rotate, left-drag release).
- **2026-07-10 (triage)** — logged 4 known bugs (deep-zoom pan look-at, alert
  fly-to birthplace, floating ship icons, mixed ADS-B units) and a batch of
  requested features (tracking boxes, nation walls, maritime/airspace boundaries,
  surveillance-orbit detection, dossier builder, watchlist-add-from-map, global
  units settings, GPS-jamming shape fidelity).
- **2026-07-10** — GitHub repo initialized + pushed (private); FIRMS key moved to
  backend proxy; directional ✈/🚁 icons + ╳ airport symbol + smaller arrows;
  deep-zoom free-look camera + pan fix; Ollama SITREP via backend proxy;
  per-layer style menu; Phase A (ghost trails, directional markers, military air,
  bike share, weather radar); Phase D (3D buildings, arrow zoom-scale, clutter
  filters v2, optimization pass).
- **2026-07-09** — QOL wave: layer icons, contact filters, search, cartography +
  labels, thermal context, alert management, snapshot DVR.
- **2026-07-08** — Global AIS + NGA World Port Index; GDELT bulk-event conflict;
  GPS jamming + denied zones; deep-zoom imagery; region-focus filtering; full
  satellite catalog; provenance badges; contact paths; airports + METAR/TAF;
  STS detection; cross-layer correlation; SQLite persistence; backend auth.

## 9 User Feature Request
1. When a ship goes dark display a ring with a secondary ring that pulses from the center to the outside then repeats signifying its last known location

some suggestions for optimization down the road. take with a grain of salt, it is from copilot.

Large/batched JSON over websockets — server broadcast (server/index.js)
Where: broadcast() serializes the full update then sends to every client (server/index.js: lines ~264–269 and relay → server wiring).
Why it can hurt: with large batches (many vessels) the serialized payload is large and is sent to every client frequently (broadcastMs = 2000ms). This increases CPU (serializing), memory (big strings), network bandwidth and can create backpressure on slow clients.
Fixes:
Send deltas instead of full frames; keep per-client cursors or sequence deltas.
Use binary formats (MessagePack, CBOR, or compact ArrayBuffers) for large numeric arrays.
Limit broadcast frequency or aggregate/priority-reduce fields (strip rarely-used meta on the wire).
Respect socket backpressure (check send callbacks / detect slow clients and drop or buffer carefully).
Hot allocation of Float32Array / attributes on each plot — layer plotting (web/src/registry.js)
Where: setLayerData/_plot() replaces the 'position' attribute with new Float32Array(...) and calls computeBoundingSphere (registry.js: ~132–160, ~156–158).
Why it can hurt: creating new typed arrays per update for many layers/points creates GC pressure and frequent GPU buffer uploads; computeBoundingSphere is O(n) and expensive.
Fixes:
Pre-allocate a capacity BufferAttribute per layer and write into its array view, then set attribute.needsUpdate = true and update attribute.count/drawRange.
Only call computeBoundingSphere when geometry size/extent actually changes (or compute a conservative, cached sphere).
Reuse buffers across updates; avoid allocating new Float32Array each frame.
Per-instance matrix updates and rescaling loops — instanced arrows (web/src/registry.js + web/src/markers.js)
Where: _ensureArrow + arrow setMatrixAt loops and rescaleArrows recompute/ setMatrixAt for every instance (registry.js: ~91–127, ~182–219; markers.arrowMatrix: ~190–207).
Why it can hurt: per-instance matrix computation for thousands of instances each update is CPU-heavy (math + allocations), and instanceMatrix.needsUpdate forces large GPU uploads.
Fixes:
Only update matrices for instances that actually moved or whose scale changed.
Use smaller update batches or a GPU-side approach (e.g., storing per-instance data in a single typed buffer and using a shader-based rotation).
Throttle rescale and avoid rebuilding instance matrices if change is negligible (already has a 12% threshold — you can increase or make it distance/LOD-aware).
Trail geometry rebuild and memory churn — TrailSet (web/src/markers.js)
Where: TrailSet.rebuild creates new Float32Array(pos) and Float32Array(col) frequently (markers.js: ~59–86).
Why it can hurt: with many tracked contacts, rebuilding arrays and replacing geometry every rebuild causes large temporary allocations and heap churn.
Fixes:
Reuse a typed buffer and write into it, then set attribute.needsUpdate.
Increase rebuild throttle for high counts, or switch to lower fidelity trails when many objects are present.
Limit per-contact history dynamically by scale/zoom or region focus.
Full scans of all vessels in hot loops — dark-scan/evict (server/ais.js)
Where: _scanDark() scans all vessels every scanIntervalMs (60s) and _evict() iterates all vessels regularly (ais.js: ~185–216).
Why it can hurt: if vessels map grows large (~tens of thousands), iterating every minute/5 minutes is O(n) work and can spike CPU. Combined with other server work this can add latency.
Fixes:
Keep a priority/expiry queue keyed by lastSeen so you only visit potentially-expired entries.
Make dark-scan incremental (process a slice each tick) or schedule checks per-vessel based on lastSeen + threshold.
Avoid repeated expensive operations inside the loop (cache Date.now once per run).
Recomputing lat/lon and heavy math inside region filtering (web/src/registry.js)
Where: _regionFilter recomputes lat/lon from xyz for every point, and does trigonometry for satellites (registry.js: ~225–258).
Why it can hurt: inverse trig (sqrt, acos, atan2) per point per filtering pass is expensive at scale.
Fixes:
Store source lat/lon/alt in meta at load time so you can test bbox/LOS without inverting every frame.
Use bounding-volume culling or coarse grids to prefilter points before exact tests.
Frequent Date.now(), object creation, and small allocations in tight loops (multiple files)
Where: TrailSet.push (markers.js), AisRelay._ingest (ais.js) pushes to arrays and constructs objects repeatedly (e.g., v.track push and shift).
Why it can hurt: many tiny allocations and Date.now calls create GC overhead and can increase tail-latency.
Fixes:
Hoist Date.now to a local variable when used in loops.
Use pooled objects or typed buffers for hot data (tracks can be compacted to Float32 + timestamps).
Avoid frequent array.shift (O(n)) — consider circular buffers.
UI/main-thread blocking: sync localStorage writes, DOM updates, and heavy render work (web/src/main.js)
Where: multiple localStorage.setItem(JSON.stringify(...)) helpers are present and stringifying large objects synchronously (main.js: lines showing save functions).
Why it can hurt: localStorage is synchronous and JSON.stringify of large objects blocks the main thread and can cause jank; heavy DOM or innerHTML updates in large loops also block frames.
Fixes:
Debounce/throttle localStorage writes; write to IndexedDB or Worker for large payloads.
Batch DOM updates using DocumentFragment or requestAnimationFrame and avoid innerHTML in tight loops.
Offload heavy computation (decoding, indexing) to Web Workers.
Texture/geometry re-creation instead of reuse (web/src/markers.js and registry.js)
Where: chevronGeometry(), quadGeometry(), directionalIconTexture(), and CanvasTexture creation are done on-demand; some geometries/materials are recreated when icon kind changes (markers.js: ~98–123, registry.js: ~95–127).
Why it can hurt: repeatedly creating geometries/textures and disposing materials costs CPU and GPU resource churn.
Fixes:
Cache shared geometries and materials globally and reuse them across layers/instances.
Only dispose when truly necessary.
Network and resource storms from many auto-refresh timers (web/src/registry.js)
Where: registry.start() calls each def.load and sets setInterval per layer if def.interval (registry.js: ~420–436).
Why it can hurt: many layers with overlapping intervals can cause bursty network load and CPU spikes.
Fixes:
Stagger layer refreshes, back off under heavy load, or coordinate network requests via a central fetch queue.
Use adaptive intervals based on visibility/region focus (don’t fetch heavy data when layer is off-screen).
Backend: streaming proxy handling and chunk copies (server/index.js)
Where: /llm endpoint reads upstream.body.getReader() and writes Buffer.from(value) per chunk (index.js: ~102–107).
Why it can hurt: each chunk copy creates new Buffer object; for high throughput stream you may allocate many small buffers.
Fixes:
Pipe streams when possible (stream pipeline) to avoid copying, or use readable.pipeTo/writable streams API to forward bytes.
