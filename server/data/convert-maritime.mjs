// Convert Marine Regions "Maritime Boundaries" WFS GeoJSON into ARGUS's compact
// maritime-boundary index (server/data/maritime.json). One-time preprocessing —
// the raw layers total ~0.5 GB; the output is a few MB of decimated polylines.
//
//   node convert-maritime.mjs eez_boundaries.json eez_12nm.json eez_24nm.json maritime.json
//
// Sources (download once from the Marine Regions GeoServer, geo.vliz.be):
//   MarineRegions:eez_boundaries — EEZ delimitation LINES (v12). Baselines are
//     dropped (they hug the coast); the rest split into settled vs disputed.
//   MarineRegions:eez_12nm — territorial-sea POLYGONS → outline rings.
//   MarineRegions:eez_24nm — contiguous-zone POLYGONS → outline rings.
// License: CC-BY — attribution "Marine Regions (marineregions.org)".
//
// Output shape (lat/lon rounded to 3 dp ≈ 110 m — display-only fidelity):
//   { attribution, eez: [[[lat,lon],…],…], disputed: […], nm12: […], nm24: […] }
import { readFileSync, writeFileSync } from 'node:fs';

const [, , srcLines, src12, src24, dst] = process.argv;

// Iterative Douglas–Peucker in lon/lat space (planar — fine for display).
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      // perpendicular distance to segment (squared, normalized after)
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol * tol) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// GeoJSON coords ([lon,lat]) → decimated [lat,lon] polyline, or null if trivial.
function toLine(coords, tol) {
  const s = simplify(coords, tol);
  if (s.length < 3) return null;
  return s.map(([lon, lat]) => [+lat.toFixed(3), +lon.toFixed(3)]);
}

function eachLine(gj, cb) {
  for (const f of gj.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const lines =
      g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates
      : g.type === 'Polygon' ? g.coordinates
      : g.type === 'MultiPolygon' ? g.coordinates.flat()
      : [];
    for (const l of lines) cb(l, f.properties ?? {});
  }
}

const stats = (arr) => `${arr.length} lines, ${arr.reduce((s, l) => s + l.length, 0)} pts`;

// ── EEZ delimitation lines: keep boundaries, drop coast-hugging baselines ──
const BASELINE = /baseline/i;
const DISPUTED = /unsettled|overlapping|claim/i; // "Unilateral claim (undisputed)" excluded below
const eez = [], disputed = [];
eachLine(JSON.parse(readFileSync(srcLines, 'utf8')), (coords, p) => {
  const t = p.line_type ?? p.LINE_TYPE ?? '';
  if (BASELINE.test(t)) return;
  const line = toLine(coords, 0.01);
  if (!line) return;
  if (DISPUTED.test(t) && !/undisputed/i.test(t)) disputed.push(line);
  else eez.push(line);
});

// ── 12 / 24 nm zone polygons → outline rings (coarser: bands hug the coast) ──
function zoneRings(src, tol) {
  const out = [];
  eachLine(JSON.parse(readFileSync(src, 'utf8')), (ring) => {
    const line = toLine(ring, tol);
    if (line) out.push(line);
  });
  return out;
}
const nm12 = zoneRings(src12, 0.02);
const nm24 = zoneRings(src24, 0.02);

const result = {
  attribution: 'Marine Regions (marineregions.org) — Maritime Boundaries v12, CC-BY',
  eez, disputed, nm12, nm24,
};
writeFileSync(dst, JSON.stringify(result));
console.log(`eez ${stats(eez)} · disputed ${stats(disputed)} · nm12 ${stats(nm12)} · nm24 ${stats(nm24)}`);
console.log(`→ ${dst} (${(JSON.stringify(result).length / 1e6).toFixed(1)} MB)`);
