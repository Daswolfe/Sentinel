import { CONFIG } from '../config.js';

// USGS all-day feed. Time-indexed so the 4D scrubber can filter to events that
// had occurred by a given moment. Feeds the alert engine for large quakes.

let cache = []; // [{ t, v(Vector3), meta }]

function render(ctx) {
  const cutoff = ctx.scrubTime() === null ? Infinity : ctx.scrubTime();
  const minMag = CONFIG.QUAKE.minMag ?? 0;
  const q = cache.filter((e) => e.t <= cutoff && (e.mag ?? 0) >= minMag);
  const pos = new Float32Array(q.length * 3);
  q.forEach((e, i) => {
    pos[i * 3] = e.v.x;
    pos[i * 3 + 1] = e.v.y;
    pos[i * 3 + 2] = e.v.z;
  });
  ctx.setLayerData('QUAKE', pos, q.map((e) => e.meta));
}

export default {
  id: 'QUAKE',
  name: 'Seismic',
  color: 0xff5d5d,
  css: '#ff5d5d',
  size: 5,
  interval: CONFIG.QUAKE.refreshMs,

  async load(ctx) {
    ctx.ui.status('QUAKE', 'wait');
    try {
      const j = await (await fetch(CONFIG.QUAKE.url)).json();
      const f = j.features || [];
      cache = f.map((q) => {
        const [lon, lat, depth] = q.geometry.coordinates;
        return {
          t: q.properties.time,
          mag: q.properties.mag ?? 0,
          v: ctx.llToV(lat, lon, ctx.R + 0.05),
          meta: {
            layer: 'QUAKE',
            lat,
            lon,
            headline: `M${q.properties.mag?.toFixed(1)} — ${q.properties.place}`,
            rows: {
              TYPE: 'SEISMIC EVENT',
              MAG: q.properties.mag,
              DEPTH: depth?.toFixed(0) + ' km',
              TIME: new Date(q.properties.time).toUTCString(),
              SOURCE: 'USGS',
            },
          },
        };
      });
      render(ctx);
      cache.forEach((e) => ctx.alerts.checkQuake(e.meta));
      ctx.ui.status('QUAKE', 'ok');
      const big = f.filter((q) => q.properties.mag >= 4.5).length;
      ctx.ui.info(`Seismic net — ${f.length} events / 24h, ${big} above M4.5`);
    } catch (e) {
      ctx.ui.status('QUAKE', 'err');
    }
  },

  onScrub(ctx) {
    render(ctx);
  },

  // Re-render from cache when the magnitude filter changes (no refetch).
  refilter(ctx) {
    render(ctx);
  },
};
