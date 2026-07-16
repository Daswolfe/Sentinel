import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Distance-from-shore lookups, backed by ~53k coastline samples (Natural Earth
// 50m, one point every ~2 nm — regenerate via data/convert-coast.mjs). Used by
// the analytics shore rule: an STS candidate pair sitting a stone's throw off
// a beach or inside a bay is an anchorage scene, not a covert mid-sea transfer.
//
// Grid: 0.5° cells; a query scans just enough neighbouring cells to cover its
// radius, so withinNm() stays O(few dozen points) even against 53k samples.
// Sample spacing means distances read up to ~1 nm long — irrelevant for
// whole-nm threshold rules.

const R_NM = 3440.065;
const CELL = 0.5;

function havNm(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class CoastIndex {
  constructor(points) {
    this.grid = new Map(); // "latCell,lonCell" -> [[lat,lon],…]
    this.count = points.length;
    for (const p of points) {
      const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(p);
    }
  }

  // Is any coastline within `nm` of (lat, lon)?
  withinNm(lat, lon, nm) {
    const latCells = Math.ceil(nm / (60 * CELL)) + 1;
    const lonScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    const lonCells = Math.ceil(nm / (60 * CELL * lonScale)) + 1;
    const cLat = Math.floor(lat / CELL);
    const cLon = Math.floor(lon / CELL);
    for (let a = -latCells; a <= latCells; a++)
      for (let b = -lonCells; b <= lonCells; b++)
        for (const p of this.grid.get(`${cLat + a},${cLon + b}`) ?? [])
          if (havNm(lat, lon, p[0], p[1]) <= nm) return true;
    return false;
  }
}

export function loadCoast() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return new CoastIndex(JSON.parse(readFileSync(join(here, 'data', 'coast.json'), 'utf8')));
  } catch {
    return new CoastIndex([]); // missing index → shore rule disabled, not fatal
  }
}
