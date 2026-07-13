import { CONFIG } from '../config.js';

// GPS interference — LIVE from gpsjam.org via the backend proxy (/api/gpsjam).
// The backend keeps only cells in the "high" interference band (default >10%
// bad fixes from ≥10 aircraft — the signature of deliberate jamming, not
// receiver noise) and clusters dense fields (Ukraine, Hormuz, Baltic…) into
// GPS-DENIED ZONES. Zones render as rings + a pickable centroid; isolated
// cells render as single points. Falls back to labeled demo zones if the
// backend or gpsjam.org is unreachable and demo=true.

export default {
  id: 'JAMMING',
  name: 'GPS Jamming',
  color: 0xe05cff,
  css: '#e05cff',
  size: 4.5,
  interval: CONFIG.JAMMING.refreshMs,

  demo: [
    { lat: 26.3, lon: 56.4, label: 'Sample zone A' },
    { lat: 44.0, lon: 34.0, label: 'Sample zone B' },
    { lat: 33.5, lon: 36.3, label: 'Sample zone C' },
  ],

  init(ctx) {
    this.ringGrp = new ctx.THREE.Group();
    ctx.scene.add(this.ringGrp);
    this.ringMat = new ctx.THREE.LineBasicMaterial({
      color: 0xe05cff,
      transparent: true,
      opacity: 0.75,
    });
  },

  onVisible(on) {
    if (this.ringGrp) this.ringGrp.visible = on;
  },

  _clearRings() {
    if (!this.ringGrp) return;
    for (const c of [...this.ringGrp.children]) {
      c.geometry.dispose();
      this.ringGrp.remove(c);
    }
  },

  _ring(ctx, zone) {
    let pts;
    if (zone.hull?.length >= 3) {
      // Accurate footprint: trace the affected-cell hull polygon (closed).
      pts = zone.hull.map(([lat, lon]) => ctx.llToV(lat, lon, ctx.R + 0.15));
      pts.push(pts[0]);
    } else {
      // Fallback: bounding circle.
      const rDeg = zone.radiusKm / 111.2;
      const stretch = 1 / Math.max(Math.cos((zone.lat * Math.PI) / 180), 0.2);
      pts = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * 2 * Math.PI;
        pts.push(ctx.llToV(zone.lat + rDeg * Math.cos(a), zone.lon + rDeg * Math.sin(a) * stretch, ctx.R + 0.15));
      }
    }
    this.ringGrp.add(new ctx.THREE.Line(new ctx.THREE.BufferGeometry().setFromPoints(pts), this.ringMat));
  },

  async load(ctx) {
    let zones = [], cells = [], date = null, live = false;
    if (CONFIG.JAMMING.url) {
      ctx.ui.status('JAMMING', 'wait');
      try {
        const u = `${CONFIG.JAMMING.url}?minPct=${CONFIG.JAMMING.minPct}&minAircraft=${CONFIG.JAMMING.minAircraft}`;
        const j = await (await fetch(u)).json();
        if (!Array.isArray(j.zones)) throw new Error(j.error || 'bad payload');
        ({ zones, cells, date } = j);
        live = true;
        ctx.ui.status('JAMMING', 'ok');
        ctx.ui.info(
          `GPS interference — ${zones.length} denied zones, ${cells.length} isolated cells (gpsjam ${date})`,
        );
      } catch (e) {
        ctx.ui.status('JAMMING', 'err');
        ctx.ui.tick('gpsjam feed unreachable' + (CONFIG.JAMMING.demo ? ' — demo zones' : ''));
        if (CONFIG.JAMMING.demo) cells = this.demo;
      }
    } else if (CONFIG.JAMMING.demo) {
      cells = this.demo;
      ctx.ui.status('JAMMING', 'sim');
    }

    this._clearRings();
    const all = [...zones, ...cells];
    const pos = new Float32Array(all.length * 3);
    const meta = [];
    all.forEach((z, i) => {
      const v = ctx.llToV(z.lat, z.lon, ctx.R + 0.15);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      const isZone = z.radiusKm != null;
      if (isZone) this._ring(ctx, z);
      meta.push({
        layer: 'JAMMING',
        lat: z.lat,
        lon: z.lon,
        headline: !live
          ? 'GPS interference — ' + (z.label || 'zone')
          : isZone
            ? `⛔ GPS DENIED ZONE — ~${z.radiusKm} km radius`
            : `GPS interference — ${z.pct}% bad fixes`,
        rows: !live
          ? {
              TYPE: 'GPS JAMMING (DEMO)',
              LAT: z.lat.toFixed(2) + '°',
              LON: z.lon.toFixed(2) + '°',
              NOTE: 'Sample data — backend proxy to gpsjam.org unavailable.',
              SOURCE: 'Demo',
            }
          : isZone
            ? {
                TYPE: 'GPS DENIED ZONE',
                RADIUS: '~' + z.radiusKm + ' km',
                'HEX CELLS': z.cells,
                'AVG BAD FIXES': z.avgPct + ' %',
                'PEAK BAD FIXES': z.maxPct + ' %',
                'AIRCRAFT SAMPLED': z.aircraft,
                CENTER: z.lat.toFixed(2) + '°, ' + z.lon.toFixed(2) + '°',
                DATE: date,
                SOURCE: 'gpsjam.org / ADS-B Exchange',
              }
            : {
                TYPE: 'GPS INTERFERENCE CELL',
                'BAD FIXES': z.pct + ' %',
                'AIRCRAFT SAMPLED': z.aircraft,
                LAT: z.lat.toFixed(2) + '°',
                LON: z.lon.toFixed(2) + '°',
                DATE: date,
                SOURCE: 'gpsjam.org / ADS-B Exchange',
              },
      });
    });
    ctx.setLayerData('JAMMING', pos, meta);
  },
};
