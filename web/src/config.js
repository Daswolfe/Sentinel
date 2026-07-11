/* ═══════════════════════════ CONFIG ═══════════════════════════ */
const CONFIG = {
  SAT: {
    // CelesTrak group: "visual" (~160 brightest), "stations", "active" (~11k —
    // everything with a live transmitter), "starlink". `max` caps how many get
    // propagated: every satellite costs an SGP4 solve per tick on the main
    // thread, so raise max and propagateMs together (1500 @ 2s ≈ smooth).
    url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
    // CelesTrak throttles each GROUP to one download per 2h update cycle; if
    // `active` is refused and nothing is cached, fall back to this group.
    fallbackUrl: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
    refreshMs: 6 * 3600e3, propagateMs: 2000, max: 1500,
  },
  AIR: {
    // OpenSky — anonymous gets ~400 credits/DAY and a GLOBAL states/all pull is
    // the most expensive call. Polling FASTER makes failures worse: at 20s you
    // burn the whole daily budget in a couple of hours, then 429s until reset.
    // Fixes: (1) free registered account + OAuth2 = 4000/day (8000 if you feed
    // ADS-B data), (2) use Region Focus mode — bounding-box pulls cost far less,
    // (3) respect the 429 backoff below.
    // Points at the SENTINEL backend proxy, which adds the OAuth2 bearer token
    // server-side (4000–8000 credits/day). Falls back to anonymous if the backend
    // has no OpenSky credentials set. To hit OpenSky directly instead, use:
    //   "https://opensky-network.org/api/states/all"
    url: "/api/opensky",
    refreshMs: 60e3, regionRefreshMs: 30e3, max: 4000,
    trailMinutes: 30,   // flight-trail persistence
    // OWN-SENSOR FEED: if you run a receiver (tar1090/readsb/dump1090), point
    // this at its JSON and SENTINEL uses YOUR antenna — zero rate limits.
    // Typical: "http://localhost:8080/data/aircraft.json"  (see SETUP.md)
    localFeed: "",
  },
  // minMag 4.5 default: below that is instrumentation chatter, not destruction.
  QUAKE: { url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", refreshMs: 5 * 60e3, minMag: 4.5 },
  EVENTS:{ url: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300", refreshMs: 15 * 60e3 },
  WEATHER:{ url: "https://api.open-meteo.com/v1/forecast" }, // point query on click
  SEA: {
    simulated: true,           // frontend fallback if the backend relay is down
    live: false,               // set true automatically when the AIS relay connects
    wsUrl:
      typeof location !== 'undefined'
        ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'
        : 'ws://localhost:8787/ws',
    snapUrl: '/api/ais/snapshot',
    AISSTREAM_KEY: "",         // key now lives in the backend .env, not here
    refreshMs: 4000, vessels: 260,
  },
  OUTAGE: { API_KEY: "", refreshMs: 10 * 60e3 },   // e.g. PowerOutage.us / EIA

  /* ── NEW LAYERS ─────────────────────────────────────────── */
  CONFLICT: {   // GDELT 2.0 bulk events via backend proxy — open, no key.
    // (GDELT's GEO JSON API is dead; the backend ingests the 15-min bulk
    // event files and serves rolling-24h conflict clusters instead.)
    url: "/api/conflict",
    refreshMs: 15 * 60e3, max: 300,
  },
  FIRMS: {      // NASA FIRMS thermal anomalies — free MAP_KEY at firms.modaps.eosdis.nasa.gov
    MAP_KEY: "f060148d2df62e23df23a20a2b4f0aec", source: "VIIRS_SNPP_NRT", days: 1, refreshMs: 30 * 60e3,
    // Realistic-fire cut: the raw feed is every warm pixel on Earth (tens of
    // thousands — flares, crop burns, rooftops). Keep detections with fire
    // radiative power ≥ minFrp MW, or brightness ≥ minBright K if FRP absent.
    minFrp: 10, minBright: 345,
  },
  LAUNCH: {     // Launch Library 2 — free. Live tier is 15 calls/hr, so we use the
    // no-rate-limit DEV endpoint (data lags a little; fine for a schedule).
    url: "https://lldev.thespacedevs.com/2.3.0/launches/upcoming/?limit=40&mode=detailed&hide_recent_previous=true",
    refreshMs: 30 * 60e3,
  },
  JAMMING: {    // GPS interference — gpsjam.org daily data via the backend proxy.
    url: "/api/gpsjam",    // clear to disable; demo=true falls back to sample zones
    demo: true,
    minPct: 10,            // only cells with >this % bad fixes (10 = gpsjam "high")
    minAircraft: 10,       // …sampled by at least this many aircraft
    refreshMs: 60 * 60e3,
  },
  INTERNET: {   // IODA / Cloudflare Radar outage signals — need token/proxy. Stub.
    API_KEY: "", refreshMs: 15 * 60e3,
  },
  MILAIR: {     // Military aircraft — adsb.lol /v2/mil via backend proxy (keyless).
    url: "/api/milair", refreshMs: 30e3, max: 800,
  },
  DOSSIER: { url: "https://api.adsbdb.com/v0/aircraft/" },  // adsbdb — no key
  AIRPORTS: {   // OurAirports open data — static catalog, METAR/TAF on click
    url: "https://davidmegginson.github.io/ourairports-data/airports.csv",
    runways: "https://davidmegginson.github.io/ourairports-data/runways.csv",
    avwx: "/api/avwx",   // backend proxy to aviationweather.gov
  },
  CITIES: {     // Natural Earth populated places — toggleable cartography layer
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson",
    max: 500, labelTop: 150,   // plot top-N by population, label the biggest
  },
  BIKE: {       // Bike share — curated GBFS systems aggregated by the backend
    url: "/api/bikeshare", refreshMs: 2 * 60e3,   // default-off, lazy-loaded on enable
  },
  BUILDINGS: {  // 3D buildings at deep zoom (Phase D)
    // Provider: OSM Buildings z15 GeoJSON tiles (footprints + height/levels).
    // The key below is their public demo key — swap in your own from
    // osmbuildings.org if you hit rate limits. UPGRADE PATH: for Google
    // Photorealistic 3D Tiles, replace the provider inside web/src/buildings.js
    // (the update()/setEnabled() interface is the seam) with 3d-tiles-renderer
    // + your Maps Platform key; nothing outside that file changes.
    url: "https://data.osmbuildings.org/0.2/{k}/tile/{z}/{x}/{y}.json",
    key: "59fcc2e8",
    showBelow: 0.5,   // globe units of altitude (~32 km) — extrusions activate
    grid: 3,          // GRID×GRID z15 tiles around the camera ground point
    maxPerTile: 2500, // safety cap on extruded footprints per tile
  },
  BORDERS: {    // Natural Earth 50m admin-0 — full-res coastline + borders + names
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
  },
  ALERTS: {     // client-side alert engine thresholds
    quakeMag: 5.0, notify: true,
  },
  ARCHIVE: { enabled: true, db: "sentinel", maxRows: 5000 },  // IndexedDB history

  SOCINT: { X_BEARER_TOKEN: "" },                  // X API v2
  TIMELINE: { snapshotMs: 15e3, maxSnapshots: 200 },   // ≈ 50 min of 4D history
  DVR: {        // long-horizon recorder behind the 4D scrubber (IndexedDB)
    cadenceMs: 60e3,     // one frame per minute
    retainHours: 4,      // default look-back window (UI-adjustable, max 48)
  },
  LLM: {
    // Local model via Ollama, proxied by the backend (/api/llm) so the browser
    // needs NO CORS config — just `ollama serve` + `ollama pull <model>`. The
    // model is whatever the backend's OLLAMA_MODEL is set to (default
    // llama3.1:8b); the report streams token-by-token. Set the model on the
    // server side (server/config.js → llm.model or OLLAMA_MODEL env).
    endpoint: "/api/llm",
  },
};

/* Region presets — camera target + OpenSky bbox [lamin,lomin,lamax,lomax] */
const REGIONS = {
  "GLOBAL":            null,
  "STRAIT OF HORMUZ":  {lat:26.3, lon:56.4,  dist:175, bbox:[22,50,30,62]},
  "RED SEA / SUEZ":    {lat:20.0, lon:38.5,  dist:210, bbox:[10,30,32,46]},
  "TAIWAN STRAIT":     {lat:24.0, lon:119.5, dist:185, bbox:[19,112,29,127]},
  "SOUTH CHINA SEA":   {lat:14.0, lon:114.0, dist:260, bbox:[4,105,24,122]},
  "KOREAN PENINSULA":  {lat:37.5, lon:127.5, dist:185, bbox:[32,122,43,132]},
  "BLACK SEA":         {lat:43.5, lon:34.0,  dist:185, bbox:[40,26,48,42]},
  "EASTERN EUROPE":    {lat:49.0, lon:31.0,  dist:230, bbox:[43,20,56,42]},
  "STRAIT OF MALACCA": {lat:3.0,  lon:100.5, dist:185, bbox:[-3,93,9,108]},
  "PANAMA CANAL":      {lat:9.1,  lon:-79.7, dist:170, bbox:[5,-84,13,-76]},
};

export { CONFIG, REGIONS };
