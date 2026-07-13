import { cellToLatLng } from 'h3-js';

// GPS interference from gpsjam.org (John Wiseman). Daily CSVs of H3 res-4 hex
// cells with counts of aircraft reporting good vs degraded GPS accuracy
// (derived from ADS-B Exchange NIC/NACp). We decode H3 → centroid server-side
// and pre-filter, so the browser gets small JSON instead of ~1 MB CSV + an H3
// dependency.
//
// gpsjam legend: bad-fix ratio 0–2% low, 2–10% medium, >10% high. Low/medium
// is mostly benign (multipath, receiver quirks, sparse sampling). Persistent
// HIGH cells with decent sampling are what actual jamming looks like, so that
// is the default cut — callers can override with ?minPct=&minAircraft=.
//
// Dense fields of high cells (Ukraine, Hormuz, Baltic…) are clustered into
// GPS-DENIED ZONES: connected components over cell centroids within
// NEIGHBOR_KM, reported with a centroid + radius instead of hundreds of dots.

const CSV_URL = (date) => `https://gpsjam.org/data/${date}-h3_4.csv`;
const RAW_MIN_PCT = 2;      // keep down to "medium" in the cache; filter per request
const RAW_MIN_AIRCRAFT = 5;
const DEFAULT_MIN_PCT = 10; // gpsjam "high" — the malicious-interference band
const DEFAULT_MIN_AIRCRAFT = 10;
const NEIGHBOR_KM = 80;     // res-4 hex centres are ~50 km apart; 80 bridges gaps
const ZONE_MIN_CELLS = 4;   // fewer than this stays individual points
const HEX_KM = 26;          // approx res-4 hex radius, pads zone edges
const CACHE_MS = 3 * 3600e3;

let cache = { t: 0, date: null, cells: null };

const dateStr = (daysAgo) =>
  new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

function distKm(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function loadCells() {
  if (cache.cells && Date.now() - cache.t < CACHE_MS) return cache;
  // Yesterday's file may not exist yet right after UTC midnight — walk back.
  let csv = null, date = null, lastErr = null;
  for (const daysAgo of [1, 2, 3]) {
    try {
      date = dateStr(daysAgo);
      const res = await fetch(CSV_URL(date));
      if (!res.ok) throw new Error(`gpsjam ${date}: HTTP ${res.status}`);
      csv = await res.text();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!csv) throw lastErr ?? new Error('gpsjam unreachable');

  const cells = [];
  for (const line of csv.split('\n').slice(1)) {
    const [hex, goodS, badS] = line.trim().split(',');
    if (!hex || !badS) continue;
    const good = +goodS, bad = +badS;
    const total = good + bad;
    if (total < RAW_MIN_AIRCRAFT) continue;
    const pct = (bad / total) * 100;
    if (pct < RAW_MIN_PCT) continue;
    try {
      const [lat, lon] = cellToLatLng(hex);
      cells.push({
        lat: +lat.toFixed(3),
        lon: +lon.toFixed(3),
        pct: +pct.toFixed(1),
        aircraft: total,
      });
    } catch (_) {} // malformed hex — skip
  }
  cache = { t: Date.now(), date, cells };
  return cache;
}

// Connected components over a coarse grid (cheap for a few thousand cells).
function cluster(cells) {
  const CELL_DEG = 1.5;
  const grid = new Map();
  const key = (c) => `${Math.floor(c.lat / CELL_DEG)},${Math.floor(c.lon / CELL_DEG)}`;
  cells.forEach((c, i) => {
    const k = key(c);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });

  const comp = new Array(cells.length).fill(-1);
  let nComp = 0;
  for (let seed = 0; seed < cells.length; seed++) {
    if (comp[seed] !== -1) continue;
    const stack = [seed];
    comp[seed] = nComp;
    while (stack.length) {
      const i = stack.pop();
      const ci = cells[i];
      const kLat = Math.floor(ci.lat / CELL_DEG);
      const kLon = Math.floor(ci.lon / CELL_DEG);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const j of grid.get(`${kLat + a},${kLon + b}`) ?? []) {
            if (comp[j] !== -1 || distKm(ci, cells[j]) > NEIGHBOR_KM) continue;
            comp[j] = nComp;
            stack.push(j);
          }
    }
    nComp++;
  }

  const groups = Array.from({ length: nComp }, () => []);
  cells.forEach((c, i) => groups[comp[i]].push(c));

  const zones = [];
  const singles = [];
  for (const g of groups) {
    if (g.length < ZONE_MIN_CELLS) {
      singles.push(...g);
      continue;
    }
    const lat = g.reduce((s, c) => s + c.lat, 0) / g.length;
    const lon = g.reduce((s, c) => s + c.lon, 0) / g.length;
    const centroid = { lat, lon };
    zones.push({
      lat: +lat.toFixed(3),
      lon: +lon.toFixed(3),
      radiusKm: Math.round(Math.max(...g.map((c) => distKm(centroid, c))) + HEX_KM),
      hull: zoneHull(g, centroid), // [[lat,lon]…] — the real affected footprint
      cells: g.length,
      maxPct: Math.max(...g.map((c) => c.pct)),
      avgPct: +(g.reduce((s, c) => s + c.pct, 0) / g.length).toFixed(1),
      aircraft: g.reduce((s, c) => s + c.aircraft, 0),
    });
  }
  zones.sort((a, b) => b.cells - a.cells);
  return { zones, singles };
}

// Convex hull (monotone chain) of the cluster's cell centroids, padded outward
// by ~one hex so the polygon encloses the cells rather than clipping their
// centres. Traces elongated fields (Ukraine front, Hormuz) far better than a
// bounding circle. Returns a closed-able ring of [lat, lon].
function zoneHull(cells, centroid) {
  const P = cells.map((c) => [c.lon, c.lat]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of P) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  lo.pop();
  up.pop();
  const hull = lo.concat(up); // [lon,lat] CCW
  const padDeg = HEX_KM / 111.2;
  const kx = Math.max(Math.cos((centroid.lat * Math.PI) / 180), 0.2);
  return hull.map(([lon, lat]) => {
    const dLat = lat - centroid.lat;
    const dLon = (lon - centroid.lon) * kx;
    const len = Math.hypot(dLat, dLon) || 1;
    return [
      +(lat + (dLat / len) * padDeg).toFixed(3),
      +(lon + (dLon / len) * padDeg / kx).toFixed(3),
    ];
  });
}

export async function getJamming(minPct = DEFAULT_MIN_PCT, minAircraft = DEFAULT_MIN_AIRCRAFT) {
  const { date, cells } = await loadCells();
  const hot = cells.filter((c) => c.pct >= minPct && c.aircraft >= minAircraft);
  const { zones, singles } = cluster(hot);
  return { date, minPct, minAircraft, zones, cells: singles };
}
