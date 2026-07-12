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

- **Phase B — CCTV + street-level** *(awaiting two free keys)*. Windy Webcams API
  (global public webcams) + Mapillary (open street-level imagery on click). Code
  design is set; blocked only on you registering the keys — the GitHub repo URL
  now exists for those forms.
- **Correlation → SITREP** *(small, unblocked)*. Every maritime alert already
  carries cross-layer context; the intel-report prompt still feeds raw counts.
  Wiring the correlated events in is the cheapest high-value win.
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

### Theme 1 — Intelligence depth *(the differentiator)*
Raw dots are commodity; correlated insight is not. This is where SENTINEL earns
the "S" in OSINT.
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

### Theme 2 — New sensors
8. **Phase B: CCTV (Windy) + Mapillary** — imminent; ship as soon as keys land.
9. **Opportunistic feeds** — filling the stubs (power/internet outages via
   IODA/Cloudflare Radar; social via X API) as keys/appetite allow.

### Theme 3 — Fidelity, cartography & boundaries
10. **Nation highlight walls** — **click a nation's name → highlight it with a
    translucent extruded wall along its borders** (reuse the Natural Earth border
    polygons already loaded for labels).
11. **Maritime & airspace boundaries** — demarcation lines for **territorial
    seas (12 nm), contiguous zone, and EEZ (200 nm)** (Natural Earth / Marine
    Regions data), plus national airspace polygons. Shared geometry powers the
    airspace tracking box (Theme 1.3).
12. **GPS-jamming shape fidelity** — the affected area currently renders as a
    **bounding circle**; replace it with a **polygon / concave hull (or per-H3-cell
    footprint)** that traces the actual affected cells, so the shape depicts the
    real region.
13. **Google Photorealistic 3D Tiles** — the `buildings.js` provider seam is
    ready; drop in `3d-tiles-renderer` + a Maps Platform key (billing) for true
    photorealistic cities at deep zoom.
14. **Filter & marker polish** — work the filter backlog (§7) as clutter demands.

### Theme 4 — UX, packaging & reach *(now that it's on GitHub)*
15. **Global units settings panel** — a settings app to set units across **all**
    layers: altitude (ft / m / flight level), speed (kt / km·h⁻¹ / mph), distance
    (nm / km / mi), temperature (°C / °F), coordinates (DD / DMS). Normalizes the
    mixed-unit ADS-B feeds (bug §4.4) behind one canonical internal unit.
16. **Contributor on-ramp** — tighten README/SETUP for a cold `git clone → npm i
    → npm run dev`; confirm keyless mode is clean.
17. **Docker Compose one-liner** — backend + static nginx for `web/dist`.
18. **Per-IP rate limiting** — required before any non-localhost deployment.
19. **Tauri desktop app** — ~10 MB native shell, Node backend as sidecar.
20. **Recorded-scenario replay** — replay a saved SQLite capture offline, for
    demos and for contributors without live keys.

### Recommended next 3 moves
1. **Correlation → SITREP** (Theme 1.1) — a few hours, disproportionate payoff;
   makes the fusion story real in the report.
2. **Phase B** the moment the Windy + Mapillary keys arrive (Theme 2.8).
3. **Tracking boxes** (Theme 1.3) — the most compelling *new* analytic, needs no
   new data source, and its crossing logic is reused by airspace tracking and the
   watchlist.

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

## 8. Changelog (high level)

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
1. When a ship goes dark display a ring with a secondary ring that pulses from the center to the outside then repeats signifying its last known locaiton
