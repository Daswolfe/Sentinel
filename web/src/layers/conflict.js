import { CONFIG } from '../config.js';

// Conflict/unrest clusters — GDELT 2.0 bulk events via the backend
// (/api/conflict). The backend ingests GDELT's 15-minute global event files,
// keeps a rolling 24 h of conflict-class events (protest, coercion, assault,
// fighting, mass violence), and clusters them to half-degree cells.
// (GDELT's old GEO JSON API is dead — 404s on every query — hence the proxy.)

export default {
  id: 'CONFLICT',
  name: 'Conflict/News',
  color: 0xff8c42,
  css: '#ff8c42',
  interval: CONFIG.CONFLICT.refreshMs,

  async load(ctx) {
    ctx.ui.status('CONFLICT', 'wait');
    try {
      const j = await (await fetch(CONFIG.CONFLICT.url)).json();
      if (!Array.isArray(j.points)) throw new Error(j.error || 'bad payload');
      const pos = new Float32Array(j.points.length * 3);
      const meta = [];
      j.points.forEach((p, i) => {
        const v = ctx.llToV(p.lat, p.lon, ctx.R + 0.065);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'CONFLICT',
          lat: p.lat,
          lon: p.lon,
          headline: `${p.kind} — ${(p.place || 'Unknown').split(',')[0]}`,
          rows: {
            TYPE: 'CONFLICT/UNREST · ' + p.kind,
            LOCATION: p.place || '—',
            'EVENTS 24H': p.events,
            'NEWS ARTICLES': p.articles,
            SAMPLE: p.url ? new URL(p.url).hostname : '—',
            SOURCE: 'GDELT 2.0 events (15-min feed)',
          },
        });
      });
      ctx.setLayerData('CONFLICT', pos, meta);
      ctx.ui.status('CONFLICT', 'ok');
      ctx.ui.info(`GDELT — ${j.points.length} conflict clusters from ${j.events} events / 24h`);
    } catch (e) {
      ctx.ui.status('CONFLICT', 'err');
      ctx.ui.tick('GDELT feed unavailable');
    }
  },
};
