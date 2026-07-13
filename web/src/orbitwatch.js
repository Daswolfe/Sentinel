import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';

// Surveillance-orbit detector (Theme 1).
//
// An ISR / holding orbit is an aircraft flying repeated circles over one spot
// (racetrack, orbit, or holding pattern) rather than transiting. We detect it by
// the WINDING NUMBER of the recent track around its own centroid: sum the signed
// angular sweep of each fix about the centroid and require ≥ MIN_LOOPS full
// revolutions inside a bounded radius. A transit doesn't wind; a circle does.
//
// Runs client-side (aircraft are fetched client-side) over AIR + MILAIR, keeping
// a rolling position history per contact. Because the feeds refresh only every
// 30–60 s, detection needs a few minutes of history to accrue before it fires.

const WINDOW_MS = 30 * 60e3;   // analyse the last 30 min of track
const MIN_POINTS = 6;          // need a handful of fixes first
const MIN_SPAN_MS = 4 * 60e3;  // …spanning at least this long
const MIN_LOOPS = 1.5;         // ≥ 1.5 revolutions around the centroid
const MAX_RADIUS_KM = 55;      // bounded loiter, not a wide transit
const MIN_RADIUS_KM = 0.6;     // actually circling, not parked on the ramp
const LAYERS = ['AIR', 'MILAIR'];

function haversineKm(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class OrbitWatch {
  constructor(scene, ctx, onAlert = () => {}) {
    this.ctx = ctx;
    this.onAlert = onAlert; // (m, orbit) => fire alert
    this.hist = new Map();  // id -> [{lat,lon,t}]
    this.latest = new Map(); // id -> current meta (for alert text)
    this.orbiting = new Map(); // id -> { lat, lon, radiusKm, loops } (flagged now)
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  scan() {
    const now = Date.now();
    const alive = new Set();

    // 1. accumulate one fix per aircraft when its position actually changed.
    for (const layer of LAYERS) {
      for (const m of this.ctx.metaFor(layer)) {
        if (m.lat == null || !m.icao) continue;
        alive.add(m.icao);
        this.latest.set(m.icao, m);
        let h = this.hist.get(m.icao);
        if (!h) { h = []; this.hist.set(m.icao, h); }
        const last = h[h.length - 1];
        if (!last || last.lat !== m.lat || last.lon !== m.lon) {
          h.push({ lat: m.lat, lon: m.lon, t: now });
          if (h.length > 200) h.shift();
        }
      }
    }

    // 2. prune stale history / departed aircraft.
    for (const [id, h] of this.hist) {
      while (h.length && now - h[0].t > WINDOW_MS) h.shift();
      if (!h.length) { this.hist.delete(id); this.latest.delete(id); }
    }

    // 3. analyse each track; collect who is orbiting now.
    const nowOrbiting = new Map();
    for (const [id, h] of this.hist) {
      if (h.length < MIN_POINTS || h[h.length - 1].t - h[0].t < MIN_SPAN_MS) continue;
      const o = this._analyse(h);
      if (o) nowOrbiting.set(id, o);
    }

    // 4. alert on aircraft that JUST started orbiting (rising edge).
    for (const [id, o] of nowOrbiting) {
      if (!this.orbiting.has(id)) this.onAlert(this.latest.get(id), o);
    }
    this.orbiting = nowOrbiting;
    this._render();
  }

  // Winding number of the track about its centroid, in a local tangent plane.
  _analyse(h) {
    let sLat = 0, sLon = 0;
    for (const p of h) { sLat += p.lat; sLon += p.lon; }
    const cLat = sLat / h.length, cLon = sLon / h.length;
    const kx = Math.max(Math.cos((cLat * Math.PI) / 180), 0.05);

    let maxR = 0, sumR = 0;
    for (const p of h) {
      const d = haversineKm(cLat, cLon, p.lat, p.lon);
      maxR = Math.max(maxR, d);
      sumR += d;
    }
    if (maxR > MAX_RADIUS_KM || maxR < MIN_RADIUS_KM) return null;

    let wind = 0, prev = null;
    for (const p of h) {
      const ang = Math.atan2(p.lat - cLat, (p.lon - cLon) * kx);
      if (prev !== null) {
        let d = ang - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        wind += d;
      }
      prev = ang;
    }
    const loops = Math.abs(wind) / (2 * Math.PI);
    if (loops < MIN_LOOPS) return null;
    return { lat: cLat, lon: cLon, radiusKm: sumR / h.length, loops };
  }

  _render() {
    for (const c of [...this.group.children]) { c.geometry.dispose(); this.group.remove(c); }
    for (const o of this.orbiting.values()) this.group.add(this._ring(o));
  }

  _ring(o) {
    const rDeg = Math.max(o.radiusKm, 3) / 111.2;
    const stretch = 1 / Math.max(Math.cos((o.lat * Math.PI) / 180), 0.2);
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      pts.push(llToV(o.lat + rDeg * Math.cos(a), o.lon + rDeg * Math.sin(a) * stretch, GLOBE_R + 0.06));
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85 }),
    );
  }
}
