// Ports & anchorages used to suppress false dark-ship flags.
//
// A vessel that legitimately berths or anchors often stops transmitting (or drops
// to receive-only). Those silences are NOT evasion. We suppress a dark flag when
// the vessel's last-known position is within `radiusNm` of a known port/anchorage.
//
// This is a curated seed list covering the major ports around the chokepoints in
// config.js. It is intentionally small and dependency-free. For production
// coverage, replace `loadPorts()` with a loader for the World Port Index (NGA, public
// domain, ~3,700 ports) or OpenStreetMap harbour/anchorage polygons — see loadPorts().

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const R_NM = 3440.065;

function haversineNm(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// [name, lat, lon, radiusNm] — radius covers the port plus its anchorage roads.
const SEED_PORTS = [
  // Persian Gulf / Hormuz
  ['Bandar Abbas', 27.13, 56.21, 12],
  ['Jebel Ali / Dubai', 25.01, 55.06, 14],
  ['Fujairah anchorage', 25.15, 56.37, 16], // huge bunkering anchorage
  ['Ras Tanura', 26.64, 50.16, 12],
  ['Dammam', 26.51, 50.20, 10],
  ['Kuwait (Shuwaikh/Shuaiba)', 29.35, 47.93, 14],
  ['Basra / Umm Qasr', 30.03, 47.93, 14],
  // Red Sea / Suez / Bab-el-Mandeb
  ['Jeddah', 21.48, 39.15, 12],
  ['Yanbu', 24.09, 38.06, 10],
  ['Port Said / Suez N.', 31.25, 32.30, 14],
  ['Suez / Port Tewfik', 29.93, 32.55, 12],
  ['Djibouti', 11.60, 43.14, 12],
  ['Aden', 12.79, 44.98, 12],
  ['Hodeidah', 14.80, 42.93, 10],
  // Malacca / SE Asia
  ['Singapore', 1.26, 103.83, 16], // one of the busiest anchorages on earth
  ['Port Klang', 3.00, 101.39, 12],
  ['Tanjung Pelepas', 1.36, 103.55, 10],
  ['Belawan', 3.79, 98.69, 10],
  // Taiwan Strait / South China Sea
  ['Kaohsiung', 22.61, 120.28, 10],
  ['Taichung', 24.29, 120.51, 8],
  ['Xiamen', 24.45, 118.07, 10],
  ['Hong Kong', 22.29, 114.13, 12],
  ['Shenzhen (Yantian)', 22.56, 114.27, 10],
  ['Guangzhou (Nansha)', 22.72, 113.63, 12],
  ['Manila', 14.58, 120.95, 12],
  // Black Sea
  ['Novorossiysk', 44.72, 37.79, 12],
  ['Constanta', 44.15, 28.66, 12],
  ['Odesa / Pivdennyi', 46.48, 30.75, 14],
  ['Istanbul / Bosphorus', 41.02, 28.97, 12],
  // Gibraltar / W. Med
  ['Algeciras / Gibraltar', 36.13, -5.44, 12],
  ['Tanger Med', 35.88, -5.50, 10],
  // Panama
  ['Balboa (Pacific)', 8.94, -79.56, 10],
  ['Cristóbal (Atlantic)', 9.35, -79.90, 10],
  // Channel / Dover
  ['Rotterdam', 51.95, 4.14, 16],
  ['Antwerp', 51.30, 4.28, 12],
  ['Felixstowe', 51.95, 1.31, 8],
  ['Le Havre', 49.48, 0.11, 10],
  ['Dover Strait anchorages', 51.10, 1.55, 12],
];

/**
 * PortIndex — fast "is this position in/near a port?" lookup.
 * Uses a coarse 1°×1° grid bucket so each query only checks nearby ports,
 * not the whole list. Scales fine to thousands of ports.
 */
export class PortIndex {
  constructor(ports = SEED_PORTS) {
    this.grid = new Map(); // "latCell,lonCell" -> [{name,lat,lon,r}]
    this.count = 0;
    for (const [name, lat, lon, r] of ports) this.add(name, lat, lon, r);
  }

  _key(lat, lon) {
    return `${Math.floor(lat)},${Math.floor(lon)}`;
  }

  add(name, lat, lon, radiusNm) {
    const port = { name, lat, lon, r: radiusNm };
    // A port's radius can spill into neighbouring cells; register in a 3×3 block
    // so a lookup in an adjacent cell still finds it.
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const k = `${Math.floor(lat) + dLat},${Math.floor(lon) + dLon}`;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(port);
      }
    }
    this.count++;
  }

  // Returns the matching port ({name, distNm}) or null.
  nearest(lat, lon) {
    const bucket = this.grid.get(this._key(lat, lon));
    if (!bucket) return null;
    let best = null;
    for (const p of bucket) {
      const d = haversineNm(lat, lon, p.lat, p.lon);
      if (d <= p.r && (!best || d < best.distNm)) best = { name: p.name, distNm: d };
    }
    return best;
  }

  inPort(lat, lon) {
    return this.nearest(lat, lon) !== null;
  }
}

/**
 * loadPorts() — returns a PortIndex backed by three layered sources (each
 * loaded best-effort; any missing file is simply skipped):
 *   1. NGA World Port Index (data/wpi.json, ~2,900 ports, public domain).
 *   2. GFW "named anchorages" (data/anchorages.json, ~14,700 AIS-derived
 *      anchorages grouped from 166k S2 cells) — where ships ACTUALLY sit still,
 *      so it catches anchorage silences the charted port list misses. This is
 *      what makes dark-ship / STS suppression (and future loitering) accurate.
 *   3. The curated seed list, whose hand-tuned radii around the chokepoints beat
 *      both heuristics.
 * Regenerate anchorages.json from the GFW named-anchorages CSV via
 *   node server/data/convert-anchorages.mjs <gfw.csv> server/data/anchorages.json
 * (rows are [name, lat, lon, radiusNm]).
 */
function readJson(here, file) {
  try {
    return JSON.parse(readFileSync(join(here, 'data', file), 'utf8'));
  } catch {
    return [];
  }
}
export function loadPorts() {
  const here = dirname(fileURLToPath(import.meta.url));
  const wpi = readJson(here, 'wpi.json');
  const anchorages = readJson(here, 'anchorages.json');
  return new PortIndex([...wpi, ...anchorages, ...SEED_PORTS]);
}
