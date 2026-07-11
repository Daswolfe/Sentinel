import * as satellite from 'satellite.js';
import { CONFIG } from '../config.js';

// CelesTrak TLEs propagated client-side with SGP4. Two cadences:
//   • load()      — refetch the TLE catalog (hours)
//   • propagate() — recompute positions (seconds), driven by main's ticker
// Scrub-aware: propagates to the exact scrub time for true 4D positioning.

let satrecs = [];

function propagate(ctx) {
  if (!satrecs.length) return;
  const scrubT = ctx.scrubTime();
  const now = scrubT !== null ? new Date(scrubT) : new Date();
  const gmst = satellite.gstime(now);
  const pos = new Float32Array(satrecs.length * 3);
  const meta = [];
  let n = 0;
  for (const s of satrecs) {
    const pv = satellite.propagate(s.rec, now);
    if (!pv.position) continue;
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(gd.latitude);
    const lon = satellite.degreesLong(gd.longitude);
    const alt = gd.height; // km
    const v = ctx.llToV(lat, lon, ctx.R * (1 + Math.min(alt, 4000) / 6371));
    pos[n * 3] = v.x;
    pos[n * 3 + 1] = v.y;
    pos[n * 3 + 2] = v.z;
    meta.push({
      layer: 'SAT',
      headline: s.name,
      trailId: s.rec.satnum, // NORAD number — stable, unique key for the trail
      lat,
      lon,
      altKm: alt, // true altitude (plot altitude is clamped) — used for LOS filter
      rows: {
        TYPE: 'SATELLITE',
        'NORAD CAT': s.rec.satnum,
        LAT: lat.toFixed(2) + '°',
        LON: lon.toFixed(2) + '°',
        ALT: alt.toFixed(0) + ' km',
        SOURCE: 'CelesTrak / SGP4',
      },
    });
    n++;
  }
  ctx.setLayerData('SAT', pos.slice(0, n * 3), meta);
}

export default {
  id: 'SAT',
  name: 'Satellites',
  color: 0x4fd6e8,
  css: '#4fd6e8',
  interval: CONFIG.SAT.refreshMs,
  // Ghost trail = the recent ground track, accumulated as SGP4 re-propagates
  // (no heading, so no arrow mode). Short + few points to stay light at 1,500 sats.
  trail: true,
  trailOpts: { maxPoints: 10, maxAgeMs: 4 * 60e3 },

  _parse(txt) {
    const lines = txt.trim().split(/\r?\n/);
    const recs = [];
    for (let i = 0; i + 2 < lines.length + 1 && recs.length < CONFIG.SAT.max; i += 3) {
      const name = lines[i]?.trim();
      const l1 = lines[i + 1];
      const l2 = lines[i + 2];
      if (!l1 || !l2 || l1[0] !== '1') continue;
      try {
        recs.push({ name, rec: satellite.twoline2satrec(l1, l2) });
      } catch (_) {}
    }
    return recs;
  },

  async load(ctx) {
    ctx.ui.status('SAT', 'wait');
    try {
      const res = await fetch(CONFIG.SAT.url);
      const txt = await res.text();
      const recs = this._parse(txt);
      // CelesTrak 403s re-downloads of a GROUP until its 2-hour update cycle
      // passes ("GP data has not updated since your last successful download").
      // Treat that — or any unparseable body — as a miss, never as an empty sky.
      if (!res.ok || !recs.length) throw new Error(`celestrak ${res.status}`);
      try {
        localStorage.setItem('sentinel.tle', JSON.stringify({ t: Date.now(), txt }));
      } catch (_) {} // quota — cache is an optimization, not a requirement
      satrecs = recs;
      propagate(ctx);
      ctx.ui.status('SAT', 'ok');
      ctx.ui.info(`TLE catalog loaded — ${recs.length} objects tracked`);
    } catch (e) {
      if (satrecs.length) return ctx.ui.status('SAT', 'ok'); // keep flying the catalog we have
      const c = JSON.parse(localStorage.getItem('sentinel.tle') || 'null');
      if (c && Date.now() - c.t < 48 * 3600e3) {
        satrecs = this._parse(c.txt);
        if (satrecs.length) {
          propagate(ctx);
          ctx.ui.status('SAT', 'ok');
          const ageH = ((Date.now() - c.t) / 3600e3).toFixed(1);
          return ctx.ui.info(`CelesTrak throttled — using cached TLEs (${satrecs.length} objects, ${ageH} h old)`);
        }
      }
      // Last resort: the (much smaller) fallback group — separate throttle bucket.
      if (CONFIG.SAT.fallbackUrl) {
        try {
          const fres = await fetch(CONFIG.SAT.fallbackUrl);
          const frecs = this._parse(await fres.text());
          if (fres.ok && frecs.length) {
            satrecs = frecs;
            propagate(ctx);
            ctx.ui.status('SAT', 'ok');
            return ctx.ui.info(`CelesTrak throttled 'active' — ${frecs.length} objects from fallback group`);
          }
        } catch (_) {}
      }
      ctx.ui.status('SAT', 'err');
      ctx.ui.tick('CelesTrak feed unreachable and no cached TLEs');
    }
  },

  // Called by main's fast ticker and by the scrubber.
  tick(ctx) {
    propagate(ctx);
  },
  onScrub(ctx) {
    propagate(ctx);
  },
};
