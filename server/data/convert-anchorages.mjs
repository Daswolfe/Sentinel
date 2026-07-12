// Convert the GFW "named anchorages" CSV (166k S2 cells) into ARGUS's compact
// anchorage index: [[name, lat, lon, radiusNm], ...] — same shape as wpi.json, so
// it drops straight into PortIndex. Cells are grouped by (label, iso3) into one
// entry per named anchorage; radius covers the cluster extent (padded, capped).
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst] = process.argv;
const lines = readFileSync(src, 'utf8').split('\n');
const head = lines[0].split(',');
const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));

const R_NM = 3440.065;
function havNm(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const groups = new Map(); // key -> { name, lats[], lons[] }
let rows = 0;
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  if (c.length < head.length) continue;
  const lat = +c[col.lat], lon = +c[col.lon];
  if (!isFinite(lat) || !isFinite(lon)) continue;
  const label = (c[col.label] || 'ANCHORAGE').trim();
  const iso3 = (c[col.iso3] || '').trim();
  const key = label + '|' + iso3;
  let g = groups.get(key);
  if (!g) { g = { name: label, lats: [], lons: [] }; groups.set(key, g); }
  g.lats.push(lat);
  g.lons.push(lon);
  rows++;
}

const out = [];
for (const g of groups.values()) {
  const n = g.lats.length;
  const lat = g.lats.reduce((s, v) => s + v, 0) / n;
  const lon = g.lons.reduce((s, v) => s + v, 0) / n;
  let maxD = 0;
  for (let i = 0; i < n; i++) maxD = Math.max(maxD, havNm(lat, lon, g.lats[i], g.lons[i]));
  // Radius = cluster extent + 1 nm pad, floored at 1.5 nm, capped at 15 nm
  // (big anchorage roads legitimately span miles; over-coverage only suppresses
  // dark flags, which is the intended behavior near anchorages).
  const r = Math.min(15, Math.max(1.5, maxD + 1));
  out.push([g.name, +lat.toFixed(4), +lon.toFixed(4), +r.toFixed(1)]);
}

writeFileSync(dst, JSON.stringify(out));
console.log(`cells: ${rows}  →  named anchorages: ${out.length}  (${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
