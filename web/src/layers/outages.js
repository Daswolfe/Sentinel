import { CONFIG } from '../config.js';

// Net Outages — internet-outage annotations from Cloudflare Radar, via the
// backend proxy (token server-side). Each outage names affected countries;
// we place a marker at each country's label point (reused from the borders
// layer, ctx.nationCentroid). Ongoing outages tick amber; ended ones grey.

const CAUSE = {
  GOVERNMENT_DIRECTED: 'Government-directed shutdown',
  POWER_OUTAGE: 'Power outage',
  CABLE_CUT: 'Cable cut',
  MILITARY_ACTION: 'Military action',
  NATURAL_DISASTER: 'Natural disaster',
  TECHNICAL_PROBLEM: 'Technical fault',
  CYBERATTACK: 'Cyber attack',
};

export default {
  id: 'INTERNET',
  name: 'Net Outages',
  color: 0xff5d5d,
  css: '#ff5d5d',
  size: 5,
  interval: 20 * 60e3,

  async load(ctx) {
    ctx.ui.status('INTERNET', 'wait');
    try {
      const j = await (await fetch(CONFIG.INTERNET.url)).json();
      const outs = j.outages || [];
      const pos = [];
      const meta = [];
      for (const o of outs) {
        o.codes.forEach((code, i) => {
          const c = ctx.nationCentroid?.get(code);
          if (!c) return;
          const v = ctx.llToV(c[0], c[1], ctx.R + 0.06);
          pos.push(v.x, v.y, v.z);
          meta.push({
            layer: 'INTERNET',
            lat: c[0],
            lon: c[1],
            headline: `${o.ongoing ? '⚠ ONGOING' : 'ENDED'} — ${o.names[i] || code} internet outage`,
            rows: {
              TYPE: 'INTERNET OUTAGE',
              COUNTRY: o.names[i] || code,
              CAUSE: CAUSE[o.cause] || o.cause || '—',
              SCOPE: o.type || '—',
              DETAIL: o.description || '—',
              START: o.start ? new Date(o.start).toUTCString() : '—',
              END: o.end ? new Date(o.end).toUTCString() : 'ongoing',
              SOURCE: 'Cloudflare Radar',
            },
          });
        });
      }
      ctx.setLayerData('INTERNET', new Float32Array(pos), meta);
      ctx.ui.status('INTERNET', meta.length ? 'ok' : 'off');
      ctx.ui.info(`Net outages — ${meta.length} country markers from ${outs.length} events (Cloudflare Radar)`);
      if (!meta.length && j.note) ctx.ui.tick(`Net Outages: ${j.note}`);
    } catch (e) {
      ctx.ui.status('INTERNET', 'err');
    }
  },
};
