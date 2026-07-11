import { CONFIG } from '../config.js';

// Military aircraft from adsb.lol's /v2/mil feed (via the backend proxy — the
// API is CORS-blocked in-browser). Global, keyless, ~250 aircraft. Same readsb
// shape as a local ADS-B receiver. Heading-oriented arrows + ghost trail come
// from the layer framework (oriented/trail below); dossier lookup on click
// reuses the civil aircraft module's adsbdb helper via main.js.

export default {
  id: 'MILAIR',
  name: 'Military Air',
  color: 0xff1493,
  css: '#ff1493',
  interval: CONFIG.MILAIR.refreshMs,
  oriented: true,
  trail: true,
  trailOpts: { maxPoints: 16, maxAgeMs: 12 * 60e3 },

  async load(ctx) {
    ctx.ui.status('MILAIR', 'wait');
    try {
      const j = await (await fetch(CONFIG.MILAIR.url)).json();
      const ac = (j.ac || j.aircraft || []).filter((a) => a.lat != null && a.lon != null);
      const rows = ac.slice(0, CONFIG.MILAIR.max);
      const pos = new Float32Array(rows.length * 3);
      const meta = [];
      let n = 0;
      for (const a of rows) {
        const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : (a.alt_geom || 0);
        const alt = Math.max(altFt, 0) * 0.0003048; // ft → km
        const v = ctx.llToV(a.lat, a.lon, ctx.R * (1 + alt / 6371) + 0.02);
        pos[n * 3] = v.x;
        pos[n * 3 + 1] = v.y;
        pos[n * 3 + 2] = v.z;
        const cs = (a.flight || '').trim();
        meta.push({
          layer: 'MILAIR',
          icao: a.hex,
          lat: a.lat,
          lon: a.lon,
          heading: a.track ?? a.mag_heading ?? null,
          altFt: typeof a.alt_baro === 'number' ? a.alt_baro : null,
          ktGs: a.gs ?? null,
          callsign: cs,
          headline: cs || (a.r || a.hex || 'MIL').toString().toUpperCase(),
          rows: {
            TYPE: 'MILITARY AIRCRAFT',
            ICAO24: a.hex || '—',
            'TYPE CODE': a.t || '—',
            REG: a.r || '—',
            CALLSIGN: cs || '—',
            LAT: a.lat.toFixed(2) + '°',
            LON: a.lon.toFixed(2) + '°',
            ALT: typeof a.alt_baro === 'number' ? a.alt_baro.toLocaleString() + ' ft' : (a.alt_baro || '—'),
            GS: a.gs != null ? a.gs.toFixed(0) + ' kt' : '—',
            TRACK: a.track != null ? a.track.toFixed(0) + '°' : '—',
            SQUAWK: a.squawk || '—',
            SOURCE: 'adsb.lol military feed',
          },
        });
        n++;
      }
      ctx.setLive('MILAIR', pos.slice(0, n * 3), meta);
      ctx.alerts.checkSquawks(meta);
      ctx.ui.status('MILAIR', 'ok');
      ctx.ui.info(`Military air — ${n} aircraft (adsb.lol)`);
    } catch (e) {
      ctx.ui.status('MILAIR', 'err');
      ctx.ui.tick('Military air feed unreachable (adsb.lol)');
    }
  },

  onRegion(ctx) {
    this.load(ctx);
  },
};
