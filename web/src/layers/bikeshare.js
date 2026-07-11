import { CONFIG } from '../config.js';

// Bike-share stations from curated GBFS systems (aggregated by the backend).
// Heavy + niche, so it's default-off and LAZY: nothing is fetched until you
// tick the layer on, then it refreshes on an interval while enabled. Each dot
// is a station; click for live bikes/docks availability.

export default {
  id: 'BIKE',
  name: 'Bike Share',
  color: 0x33e0a1,
  css: '#33e0a1',
  size: 2.4,
  defaultOff: true,
  lazy: true, // registry skips auto-load; onVisible drives the first fetch

  init(ctx) {
    this._ctx = ctx;
    ctx.ui.status('BIKE', 'off'); // lazy + default-off: idle until enabled
  },

  // Lazy-load on first enable; keep refreshing only while visible.
  onVisible(on) {
    const ctx = this._ctx;
    if (on && !this._timer) {
      this.load(ctx);
      this._timer = setInterval(() => this.load(ctx), CONFIG.BIKE.refreshMs);
    } else if (!on && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  async load(ctx) {
    ctx.ui.status('BIKE', 'wait');
    try {
      const j = await (await fetch(CONFIG.BIKE.url)).json();
      const st = j.stations || [];
      const pos = new Float32Array(st.length * 3);
      const meta = [];
      st.forEach((s, i) => {
        const v = ctx.llToV(s.lat, s.lon, ctx.R + 0.03);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'BIKE',
          lat: s.lat,
          lon: s.lon,
          headline: `${s.name || 'Station'} — ${s.sys}`,
          rows: {
            TYPE: 'BIKE-SHARE STATION',
            SYSTEM: s.sys,
            'BIKES AVAIL': s.bikes ?? '—',
            'DOCKS FREE': s.docks ?? '—',
            CAPACITY: s.cap ?? '—',
            LAT: s.lat.toFixed(4) + '°',
            LON: s.lon.toFixed(4) + '°',
            SOURCE: 'GBFS (' + s.sys + ')',
          },
        });
      });
      ctx.setLayerData('BIKE', pos, meta);
      ctx.ui.status('BIKE', 'ok');
      ctx.ui.info(`Bike share — ${st.length} stations across ${j.systems?.length ?? 0} systems`);
    } catch (e) {
      ctx.ui.status('BIKE', 'err');
      ctx.ui.tick('Bike-share feed unreachable (GBFS)');
    }
  },
};
