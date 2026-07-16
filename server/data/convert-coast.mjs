// Convert the Natural Earth 50m coastline GeoJSON into ARGUS's compact coast
// sample index (server/data/coast.json): a flat [[lat,lon],…] array with one
// point roughly every SPACING_NM along every coastline. Used by the analytics
// shore-distance rule (STS transfers must be ≥ N nm from shore, so anchored
// clusters hugging the coast stop false-flagging).
//
//   node convert-coast.mjs ne_50m_coastline.geojson coast.json
//
// Distance to the nearest SAMPLE overstates distance to the actual coast by at
// most ~SPACING_NM/2 — fine for a threshold rule in whole nautical miles.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst] = process.argv;
const SPACING_NM = 2;

const R_NM = 3440.065;
function havNm(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const gj = JSON.parse(readFileSync(src, 'utf8'));
const out = [];
let lines = 0;
for (const f of gj.features ?? []) {
  const g = f.geometry;
  if (!g) continue;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const coords of parts) {
    lines++;
    let sinceNm = Infinity; // force-emit the first point of every line
    let prev = null;
    for (const [lon, lat] of coords) {
      if (prev) sinceNm += havNm(prev[0], prev[1], lat, lon);
      if (sinceNm >= SPACING_NM) {
        out.push([+lat.toFixed(3), +lon.toFixed(3)]);
        sinceNm = 0;
      }
      prev = [lat, lon];
    }
  }
}
writeFileSync(dst, JSON.stringify(out));
console.log(`${lines} coastlines → ${out.length} samples @ ~${SPACING_NM} nm (${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
