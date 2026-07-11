import { CONFIG } from '../config.js';

// NASA EONET — open natural events (storms, wildfires, volcanoes, ice, etc.).

export default {
  id: 'EVENTS',
  name: 'Weather/Events',
  color: 0xb98cf5,
  css: '#b98cf5',
  interval: CONFIG.EVENTS.refreshMs,

  async load(ctx) {
    ctx.ui.status('EVENTS', 'wait');
    try {
      const j = await (await fetch(CONFIG.EVENTS.url)).json();
      const ev = (j.events || []).filter((e) => e.geometry?.length);
      const pos = new Float32Array(ev.length * 3);
      const meta = [];
      ev.forEach((e, i) => {
        const g = e.geometry[e.geometry.length - 1];
        const c = g.type === 'Point' ? g.coordinates : g.coordinates[0][0];
        const v = ctx.llToV(c[1], c[0], ctx.R + 0.07);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'EVENTS',
          headline: e.title,
          rows: {
            TYPE: (e.categories?.[0]?.title || 'EVENT').toUpperCase(),
            UPDATED: new Date(g.date).toUTCString(),
            SOURCE: 'NASA EONET',
          },
        });
      });
      ctx.setLayerData('EVENTS', pos, meta);
      ctx.ui.status('EVENTS', 'ok');
      ctx.ui.info(`EONET — ${ev.length} open natural events worldwide`);
    } catch (e) {
      ctx.ui.status('EVENTS', 'err');
    }
  },
};
