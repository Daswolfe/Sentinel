import { CONFIG } from '../config.js';

// Launch Library 2 — upcoming rocket launches, plotted at the pad.
// Uses the no-rate-limit dev endpoint (see config). Feeds imminent-launch alerts.

export default {
  id: 'LAUNCH',
  name: 'Launches',
  color: 0x7fe3ff,
  css: '#7fe3ff',
  interval: CONFIG.LAUNCH.refreshMs,

  async load(ctx) {
    ctx.ui.status('LAUNCH', 'wait');
    try {
      const j = await (await fetch(CONFIG.LAUNCH.url)).json();
      const res = (j.results || []).filter((l) => l.pad?.latitude);
      const pos = new Float32Array(res.length * 3);
      const meta = [];
      res.forEach((l, i) => {
        const lat = +l.pad.latitude;
        const lon = +l.pad.longitude;
        const v = ctx.llToV(lat, lon, ctx.R + 0.075);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'LAUNCH',
          headline: l.name,
          rows: {
            TYPE: 'ROCKET LAUNCH',
            PROVIDER: l.launch_service_provider?.name || '—',
            NET: new Date(l.net).toUTCString(),
            STATUS: l.status?.name || '—',
            PAD: l.pad?.name || '—',
            SOURCE: 'Launch Library 2',
          },
        });
        ctx.alerts.checkLaunch(l, lat, lon);
      });
      ctx.setLayerData('LAUNCH', pos, meta);
      ctx.ui.status('LAUNCH', 'ok');
      ctx.ui.info(`Launch schedule — ${res.length} upcoming with known pads`);
    } catch (e) {
      ctx.ui.status('LAUNCH', 'err');
    }
  },
};
