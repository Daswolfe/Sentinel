import { EventEmitter } from 'node:events';
import { getJamming } from './gpsjam.js';
import { getConflict } from './gdelt.js';

// Tier-3 analytics over the live picture.
//
// STS (ship-to-ship transfer) candidates: two vessels essentially stopped
// (SOG ≤ 0.8 kt), within PAIR_M of each other, NOT near any known port or
// anchorage, holding that geometry for ≥ HOLD_MS — the classic covert
// transfer signature (sanctioned oil, contraband). Scanned every SCAN_MS
// over a coarse grid so the pass stays cheap even at 30k+ vessels.
//
// Cross-layer correlation: when a dark/resurface/STS event fires, the caller
// can ask correlate() whether it sits inside a GPS-denied zone or near a
// conflict cluster — the "why this matters" context, attached to the alert.

const STOP_SOG = 0.8;      // kt — effectively stationary
const PAIR_M = 500;        // metres between the pair
const HOLD_MS = 25 * 60e3; // sustained this long => candidate
const SCAN_MS = 5 * 60e3;
const MIN_REPORTS = 5;     // require a short track first

function distM(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class Analytics extends EventEmitter {
  constructor(relay) {
    super();
    this.relay = relay;
    this.pairs = new Map(); // "mmsiA-mmsiB" -> { t0, alerted }
    this.stats = { stsCandidates: 0, stsAlerts: 0 };
  }

  start() {
    this._t = setInterval(() => {
      try {
        this.scan();
      } catch (_) {}
    }, SCAN_MS);
  }

  stop() {
    clearInterval(this._t);
  }

  scan() {
    const now = Date.now();
    const ports = this.relay.ports;
    // Collect stopped vessels in open water.
    const stopped = [];
    for (const v of this.relay.vessels.values()) {
      if ((v.sog ?? 99) > STOP_SOG || v.reports < MIN_REPORTS || v.lat == null) continue;
      if (ports.nearest(v.lat, v.lon)) continue; // berth/anchorage — legitimate
      stopped.push(v);
    }
    // Coarse grid (~1.1 km cells); only neighbours are distance-checked.
    const CELL = 0.01;
    const grid = new Map();
    const key = (la, lo) => `${Math.floor(la / CELL)},${Math.floor(lo / CELL)}`;
    for (const v of stopped) {
      const k = key(v.lat, v.lon);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(v);
    }
    const seen = new Set();
    for (const v of stopped) {
      const kLat = Math.floor(v.lat / CELL);
      const kLon = Math.floor(v.lon / CELL);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const w of grid.get(`${kLat + a},${kLon + b}`) ?? []) {
            if (w.mmsi <= v.mmsi) continue; // each pair once
            const m = distM(v.lat, v.lon, w.lat, w.lon);
            if (m > PAIR_M) continue;
            const pk = `${v.mmsi}-${w.mmsi}`;
            seen.add(pk);
            let p = this.pairs.get(pk);
            if (!p) {
              p = { t0: now, alerted: false };
              this.pairs.set(pk, p);
              this.stats.stsCandidates++;
            }
            if (!p.alerted && now - p.t0 >= HOLD_MS) {
              p.alerted = true;
              this.stats.stsAlerts++;
              this.emit('alert', {
                kind: 'sts',
                vessel: this.relay._pub(v),
                vessel2: this.relay._pub(w),
                meters: Math.round(m),
                minutes: Math.round((now - p.t0) / 60e3),
              });
            }
          }
    }
    // Pairs that broke geometry reset their clock.
    for (const k of this.pairs.keys()) if (!seen.has(k)) this.pairs.delete(k);
  }
}

// Attach cross-layer context to a maritime alert: GPS-denied zones and
// conflict clusters near the event position. Both sources are served from
// this process's own caches, so this is cheap; failures degrade silently.
export async function correlate(alert) {
  const v = alert.vessel;
  if (!v || v.lat == null) return alert;
  const context = [];
  try {
    const { zones } = await getJamming();
    for (const z of zones) {
      const km = distM(v.lat, v.lon, z.lat, z.lon) / 1000;
      if (km < z.radiusKm + 100) {
        context.push(`inside/near GPS-denied zone (${z.radiusKm} km, peak ${z.maxPct}% bad fixes)`);
        break;
      }
    }
  } catch (_) {}
  try {
    const { points } = await getConflict();
    let best = null, bestKm = 250;
    for (const p of points ?? []) {
      const km = distM(v.lat, v.lon, p.lat, p.lon) / 1000;
      if (km < bestKm) {
        bestKm = km;
        best = p;
      }
    }
    if (best)
      context.push(
        `${best.events} conflict events within ${Math.round(bestKm)} km (${(best.place || '').split(',')[0]})`,
      );
  } catch (_) {}
  if (context.length) alert.context = context;
  return alert;
}
