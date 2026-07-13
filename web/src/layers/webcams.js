import { CONFIG } from '../config.js';

// Public webcams (CCTV mesh) from Windy Webcams, via the backend proxy (key
// server-side). Global + numerous, so this is a lazy, default-off layer that
// loads webcams near the CURRENT VIEW CENTRE when enabled and refetches when
// you focus a different region. Click a camera to see its latest still image in
// the detail panel.

export default {
  id: 'CCTV',
  name: 'Webcams',
  color: 0x8fd6ff,
  css: '#8fd6ff',
  size: 3.2,
  defaultOff: true,
  lazy: true, // registry skips auto-load; onVisible drives the first fetch

  init(ctx) {
    this._ctx = ctx;
    ctx.ui.status('CCTV', 'off'); // lazy + default-off: idle until enabled
  },

  onVisible(on) {
    if (on) this.load(this._ctx);
  },

  // Reload for the new area when a region is focused while the layer is on.
  onRegion(ctx) {
    if (ctx.layers.get('CCTV')?.visible) this.load(ctx);
  },

  async load(ctx) {
    const region = ctx.region();
    const lat = region?.lat ?? ctx.viewLat;
    const lon = region?.lon ?? ctx.viewLon;
    if (lat == null || lon == null) return;
    ctx.ui.status('CCTV', 'wait');
    try {
      const u = `${CONFIG.CCTV.url}?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radius=${CONFIG.CCTV.radiusKm}`;
      const j = await (await fetch(u)).json();
      const cams = j.webcams || [];
      const pos = new Float32Array(cams.length * 3);
      const meta = [];
      cams.forEach((w, i) => {
        const v = ctx.llToV(w.lat, w.lon, ctx.R + 0.04);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'CCTV',
          lat: w.lat,
          lon: w.lon,
          headline: w.title || 'Webcam',
          html: w.preview
            ? `<img class="camimg" src="${w.preview}" referrerpolicy="no-referrer" alt="webcam">`
            : '',
          rows: {
            TYPE: 'PUBLIC WEBCAM',
            CITY: w.city || '—',
            COUNTRY: w.country || '—',
            LAT: w.lat.toFixed(3) + '°',
            LON: w.lon.toFixed(3) + '°',
            SOURCE: 'Windy Webcams',
          },
        });
      });
      ctx.setLayerData('CCTV', pos, meta);
      ctx.ui.status('CCTV', cams.length ? 'ok' : 'off');
      ctx.ui.info(`Webcams — ${cams.length} within ${CONFIG.CCTV.radiusKm} km of ${lat.toFixed(1)}, ${lon.toFixed(1)}`);
      if (!cams.length && j.note) ctx.ui.tick(`Webcams: ${j.note}`);
    } catch (e) {
      ctx.ui.status('CCTV', 'err');
      ctx.ui.tick('Webcams feed unreachable (Windy)');
    }
  },
};
