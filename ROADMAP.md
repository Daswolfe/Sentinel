# SENTINEL — Roadmap & Strategy

An open-source 4D geospatial command center: one Three.js globe fusing live
satellites, aircraft (civil + military), maritime AIS with dark-ship detection,
seismic, conflict, GPS-jamming, thermal, launches, airports, cities, and bike
share — with deep-zoom imagery + 3D buildings, weather radar, a 4D time
scrubber, an alert engine, and a local-LLM intel report.

**Repo:** github.com/Daswolfe/Sentinel (private) · **Last updated:** 2026-07-10

---

## 1. Where it stands

The single-file prototype is long gone. SENTINEL is a small monorepo — a
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
  (dark-minutes + jump nm), NGA World Port Index (~2,900 ports) false-positive
  suppression.
- **STS-transfer detection** (`analytics.js`) — stationary pairs ≤500 m, away
  from port, ≥25 min → alert.
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

- **Phase B — CCTV + street-level** *(awaiting two free keys)*. Windy Webcams API
  (global public webcams) + Mapillary (open street-level imagery on click). Code
  design is set; blocked only on you registering the keys — the GitHub repo URL
  now exists for those forms.
- **Correlation → SITREP** *(small, unblocked)*. Every maritime alert already
  carries cross-layer context; the intel-report prompt still feeds raw counts.
  Wiring the correlated events in is the cheapest high-value win.
- **Loitering / route-anomaly** *(blocked on data)*. Needs OSM anchorage polygons
  or a learned shipping-lane baseline first, or it false-positives on every
  legitimate anchorage.

---

## 4. Strategy from here

The tool is now broad. The strategic pivot is from *breadth* (more feeds) toward
**depth** (turning feeds into insight) and **reach** (making it runnable and
shareable now that it's on GitHub). Four themes, roughly in priority order:

### Theme 1 — Intelligence depth *(the differentiator)*
Raw dots are commodity; correlated insight is not. This is where SENTINEL earns
the "S" in OSINT.
1. **Correlation into the LLM SITREP** — feed the already-computed cross-layer
   context (dark ship inside a jamming zone near a conflict cluster) to the
   report instead of counts. Cheap, immediate.
2. **Watchlist v2** — per-entry colour + **alert-on-appear** (a watchlist contact
   entering the plot fires an alert). Turns the passive watchlist active.
3. **Loitering & route-anomaly** — once anchorage polygons / lane baselines are
   sourced. Highest-value single analytic after STS.
4. **Pattern-of-life queries** — the SQLite archive already holds days of tracks;
   expose "every dark event in Hormuz this month" style queries + a history panel.

### Theme 2 — New sensors
5. **Phase B: CCTV (Windy) + Mapillary** — imminent; ship as soon as keys land.
6. **Opportunistic feeds** — filling the stubs (power/internet outages via
   IODA/Cloudflare Radar; social via X API) as keys/appetite allow.

### Theme 3 — Fidelity & immersion
7. **Google Photorealistic 3D Tiles** — the `buildings.js` provider seam is ready;
   drop in `3d-tiles-renderer` + a Maps Platform key (billing) for true
   photorealistic cities at deep zoom.
8. **Filter & marker polish** — work the filter backlog (§6) as clutter demands.

### Theme 4 — Packaging & reach *(now that it's on GitHub)*
9. **Contributor on-ramp** — the repo is public-ready; tighten README/SETUP for a
   cold `git clone → npm i → npm run dev`, and confirm keyless-mode works clean.
10. **Docker Compose one-liner** — backend + static nginx for `web/dist`.
11. **Per-IP rate limiting** — required before any non-localhost deployment.
12. **Tauri desktop app** — ~10 MB native shell, Node backend as sidecar.
13. **Recorded-scenario replay** — replay a saved SQLite capture offline, for
    demos and for contributors without live keys.

### Recommended next 3 moves
1. **Correlation → SITREP** (Theme 1.1) — a few hours, disproportionate payoff;
   makes the fusion story real in the report.
2. **Phase B** the moment the Windy + Mapillary keys arrive (Theme 2.5).
3. **Watchlist v2 alert-on-appear** (Theme 1.2) — the most compelling analytic
   that needs no new data source.

---

## 5. Known limitations to keep visible

- **FIRMS global daily** can return sparse/header-only responses under the free
  key's transaction limit; region-focused queries are more reliable.
- **Bike-share `bikes` field** is null for GBFS v3 vehicle-type systems (e.g.
  Buenos Aires); docks/capacity still populate.
- **Private repo** can't be *opened* by Mapillary/Windy reviewers — flip to
  public if a key request is rejected (repo is already scrubbed of secrets).

---

## 6. Backlog — filters & nice-to-haves

- **Vessel class** — AIS ship-type groups (tanker 80s / cargo 70s / passenger /
  fishing / tug / military 35); data on `meta.shipType`.
- **Aircraft category** — readsb `category` (light…heavy, glider, rotorcraft).
- **Emergency only** — squawk 7500/7600/7700 across AIR + MILAIR.
- **Speed band** — fast-mover cut (>600 kt) for intercept watching.
- **Density cap** — "top N by relevance in view" instead of hard toggles.
- **Dark-duration** — only ships silent > N hours.
- **Constellation** — satellite owner grouping (Starlink / GLONASS / GPS / mil).
- **Route stage** — climb/cruise/descent via vertical-rate sign.

---

## 7. Changelog (high level)

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
