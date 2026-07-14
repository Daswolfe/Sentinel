import { CONFIG } from '../config.js';
import { acCategory } from '../contactFilters.js';
import { fmtAlt, fmtSpeed, fmtLat, fmtLon } from '../units.js';

// Aircraft from OpenSky (via backend proxy) or a local ADS-B receiver.
// Region-aware: narrows to a bounding box when a region is focused. Handles
// 429 backoff, emergency-squawk alerts, and adsbdb dossier lookups on click.
// Ghost trail + heading-oriented arrow markers come from the layer framework
// (trail:true / oriented:true below).

export default {
  id: 'AIR',
  name: 'Aircraft',
  color: 0xffb454,
  css: '#ffb454',
  interval: CONFIG.AIR.refreshMs,
  oriented: true, // can render heading-aligned arrows (icon ➤)
  trail: true,
  trailOpts: { maxPoints: 16, maxAgeMs: 10 * 60e3 },

  async load(ctx) {
    ctx.ui.status('AIR', 'wait');

    // Own-sensor path: tar1090/readsb/dump1090 JSON — no rate limits.
    if (CONFIG.AIR.localFeed) {
      try {
        const j = await (await fetch(CONFIG.AIR.localFeed)).json();
        const ac = (j.aircraft || []).filter((a) => a.lat != null && a.lon != null);
        const pos = new Float32Array(ac.length * 3);
        const meta = [];
        let n = 0;
        for (const a of ac) {
          const alt = (a.alt_baro || a.alt_geom || 0) * 0.0003048; // ft→km
          const v = ctx.llToV(a.lat, a.lon, ctx.R * (1 + Math.max(alt, 0) / 6371) + 0.02);
          pos[n * 3] = v.x;
          pos[n * 3 + 1] = v.y;
          pos[n * 3 + 2] = v.z;
          meta.push({
            layer: 'AIR',
            icao: a.hex,
            lat: a.lat,
            lon: a.lon,
            heading: a.track ?? null,
            altFt: a.alt_baro ?? a.alt_geom ?? null, // fast fields for filters
            ktGs: a.gs ?? null,
            squawk: a.squawk || null,
            vr: a.baro_rate ?? a.geom_rate ?? null, // ft/min
            cat: acCategory(a.category),
            callsign: (a.flight || '').trim(),
            headline: (a.flight || '').trim() || a.hex,
            rows: {
              TYPE: 'AIRCRAFT (local RX)',
              ICAO24: a.hex,
              LAT: fmtLat(a.lat),
              LON: fmtLon(a.lon),
              ALT: fmtAlt(a.alt_baro ?? a.alt_geom),
              GS: fmtSpeed(a.gs),
              SQUAWK: a.squawk || '—',
              SOURCE: 'Own ADS-B receiver',
            },
          });
          n++;
        }
        ctx.setLive('AIR', pos.slice(0, n * 3), meta);
        ctx.alerts.checkSquawks(meta);
        ctx.ui.status('AIR', 'ok');
        ctx.ui.info(`Own receiver — ${n} aircraft (no rate limit)`);
        return;
      } catch (e) {
        ctx.ui.tick('Local receiver feed unreachable — falling back to OpenSky');
      }
    }

    try {
      const bb = ctx.region()?.bbox;
      // extended=true adds the aircraft-category enum (element 17) to each state.
      const url = bb
        ? `${CONFIG.AIR.url}?extended=true&lamin=${bb[0]}&lomin=${bb[1]}&lamax=${bb[2]}&lomax=${bb[3]}`
        : CONFIG.AIR.url + '?extended=true';
      const res = await fetch(url);
      if (res.status === 429) {
        const wait = res.headers.get('X-Rate-Limit-Retry-After-Seconds');
        ctx.ui.status('AIR', 'err');
        ctx.ui.tick(
          `OpenSky credit budget exhausted — retry in ${wait ?? '?'} s (register for 10× limit)`,
        );
        return;
      }
      const j = await res.json();
      const states = (j.states || []).slice(0, CONFIG.AIR.max);
      const pos = new Float32Array(states.length * 3);
      const meta = [];
      let n = 0;
      for (const s of states) {
        const lon = s[5];
        const lat = s[6];
        if (lat == null || lon == null) continue;
        const alt = (s[13] ?? s[7] ?? 0) / 1000;
        const v = ctx.llToV(lat, lon, ctx.R * (1 + Math.max(alt, 0) / 6371) + 0.02);
        pos[n * 3] = v.x;
        pos[n * 3 + 1] = v.y;
        pos[n * 3 + 2] = v.z;
        meta.push({
          layer: 'AIR',
          icao: s[0],
          lat,
          lon,
          heading: s[10] ?? null, // true_track
          altFt: alt * 3280.84,   // fast fields for filters
          ktGs: s[9] != null ? s[9] * 1.944 : null,
          squawk: s[14] || null,
          vr: s[11] != null ? s[11] * 196.85 : null, // m/s → ft/min
          cat: acCategory(s[17]),
          callsign: (s[1] || '').trim(),
          headline: (s[1] || '').trim() || s[0].toUpperCase(),
          rows: {
            TYPE: 'AIRCRAFT',
            ICAO24: s[0],
            ORIGIN: s[2] || '—',
            LAT: fmtLat(lat),
            LON: fmtLon(lon),
            // Canonical internal unit = feet (OpenSky reports metres); the
            // units helpers convert to the user's display preference.
            ALT: fmtAlt(alt * 3280.84),
            GS: fmtSpeed(s[9] != null ? s[9] * 1.944 : null),
            HDG: s[10] != null ? s[10].toFixed(0) + '°' : '—',
            SQUAWK: s[14] || '—',
            SOURCE: 'OpenSky ADS-B',
          },
        });
        n++;
      }
      ctx.setLive('AIR', pos.slice(0, n * 3), meta);
      ctx.alerts.checkSquawks(meta);
      ctx.ui.status('AIR', 'ok');
      ctx.ui.info(`ADS-B sweep — ${n} aircraft on plot${bb ? ' (region bbox)' : ''}`);
    } catch (e) {
      ctx.ui.status('AIR', 'err');
      ctx.ui.tick('OpenSky unreachable (rate limit or CORS) — retrying next cycle');
    }
  },

  onRegion(ctx) {
    this.load(ctx);
  },

  // adsbdb enrichment for the detail panel (called from picking).
  async dossier(icao, callsign) {
    const u =
      CONFIG.DOSSIER.url + icao + (callsign ? `?callsign=${encodeURIComponent(callsign)}` : '');
    const j = await (await fetch(u)).json();
    return j.response || null;
  },
};
