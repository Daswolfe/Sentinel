import { CONFIG } from '../config.js';
import { connectMaritime } from './maritime.js';
import { fmtSpeed, fmtLat, fmtLon } from '../units.js';

// SEA + DARK layers. Prefers the live backend AIS relay; falls back to a
// self-contained simulation on real chokepoint lanes when the relay is down.
// Registered as ONE module that owns both layer IDs.

const LANES = [
  ['Strait of Hormuz', [[26.6, 56.5], [26.2, 56.9], [25.6, 57.3], [25.2, 58.2]]],
  ['Suez / Red Sea', [[31.3, 32.3], [29.9, 32.6], [27.5, 34.0], [23.0, 36.5], [15.0, 41.8], [12.6, 43.4]]],
  ['Strait of Malacca', [[6.3, 95.2], [4.5, 98.5], [2.5, 101.3], [1.3, 103.8], [1.2, 104.6]]],
  ['Panama Canal', [[9.4, -79.9], [9.1, -79.7], [8.9, -79.5]]],
  ['Gibraltar', [[36.1, -6.5], [35.95, -5.6], [36.0, -4.5]]],
  ['Bab el-Mandeb', [[13.5, 42.8], [12.6, 43.3], [11.8, 44.5]]],
  ['English Channel', [[50.4, -1.5], [50.6, 0.5], [51.0, 1.5], [51.3, 2.2]]],
  ['Taiwan Strait', [[22.5, 118.0], [24.0, 119.0], [25.5, 120.5]]],
];

let vesselState = null;
let simDark = [];

// Detail rows are built LAZILY (first access, i.e. on pick): with 10k+ live
// vessels re-plotted every 500 ms, eagerly formatting ~10 strings per vessel
// was megabytes/second of GC churn for panels nobody had opened.
function seaMeta(v) {
  return {
    layer: 'SEA',
    mmsi: v.mmsi,
    lat: v.lat,
    lon: v.lon,
    heading: v.cog ?? v.heading ?? null, // course/heading for arrow orientation
    sog: v.sog ?? null,                  // fast fields for filters
    shipType: v.type ?? null,
    headline: v.name || 'MMSI ' + v.mmsi,
    get rows() {
      return (this._r ??= {
        TYPE: 'VESSEL (LIVE AIS)',
        MMSI: v.mmsi,
        'SHIP TYPE': v.type ?? '—',
        LAT: fmtLat(v.lat),
        LON: fmtLon(v.lon),
        SOG: fmtSpeed(v.sog),
        COG: v.cog != null ? v.cog.toFixed(0) + '°' : '—',
        DEST: v.destination ?? '—',
        SOURCE: 'aisstream.io (via backend)',
      });
    },
  };
}

function darkMeta(v) {
  return {
    layer: 'DARK',
    mmsi: v.mmsi,
    lat: v.lat,
    lon: v.lon,
    heading: v.cog ?? v.heading ?? null,
    sog: v.sog ?? null,
    shipType: v.type ?? null,
    darkAt: v.darkAt ?? null, // fast field for the dark-duration filter
    headline: `⚠ DARK — ${v.name || 'MMSI ' + v.mmsi}`,
    get rows() {
      return (this._r ??= {
        TYPE: 'AIS BLACKOUT',
        MMSI: v.mmsi,
        'LAST LAT': fmtLat(v.lat),
        'LAST LON': fmtLon(v.lon),
        'WENT DARK': v.darkAt ? new Date(v.darkAt).toUTCString() : '—',
        NOTE: 'Transponder silent while underway — possible evasion',
        SOURCE: 'Derived (live AIS)',
      });
    },
  };
}

function plotLive(ctx, vessels, dark) {
  const spos = new Float32Array(vessels.length * 3);
  const smeta = [];
  vessels.forEach((v, i) => {
    const p = ctx.llToV(v.lat, v.lon, ctx.R + 0.0015);
    spos[i * 3] = p.x;
    spos[i * 3 + 1] = p.y;
    spos[i * 3 + 2] = p.z;
    smeta.push(seaMeta(v));
  });
  ctx.setLayerData('SEA', spos, smeta);

  const dpos = new Float32Array(dark.length * 3);
  const dmeta = [];
  dark.forEach((v, i) => {
    const p = ctx.llToV(v.lat, v.lon, ctx.R + 0.002);
    dpos[i * 3] = p.x;
    dpos[i * 3 + 1] = p.y;
    dpos[i * 3 + 2] = p.z;
    dmeta.push(darkMeta(v));
  });
  ctx.setLayerData('DARK', dpos, dmeta);
}

function simulate(ctx) {
  if (CONFIG.SEA.live) return; // live relay owns the layers
  const N = CONFIG.SEA.vessels;
  if (!vesselState) {
    vesselState = Array.from({ length: N }, (_, i) => {
      const lane = LANES[i % LANES.length];
      return {
        lane,
        t: Math.random(),
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 0.0006 + Math.random() * 0.0012,
        mmsi: 200000000 + Math.floor(Math.random() * 7e8),
        kind: ['TANKER', 'CARGO', 'CONTAINER', 'LNG', 'BULK'][i % 5],
        dark: false,
      };
    });
  }
  const live = [];
  vesselState.forEach((v, i) => {
    v.t += v.speed * v.dir;
    if (v.t > 1 || v.t < 0) {
      v.dir *= -1;
      v.t = Math.max(0, Math.min(1, v.t));
    }
    const wps = v.lane[1];
    const f = v.t * (wps.length - 1);
    const k = Math.min(Math.floor(f), wps.length - 2);
    const u = f - k;
    const lat = wps[k][0] + (wps[k + 1][0] - wps[k][0]) * u + Math.sin(i * 7.3) * 0.25;
    const lon = wps[k][1] + (wps[k + 1][1] - wps[k][1]) * u + Math.cos(i * 3.1) * 0.25;
    if (!v.dark && Math.random() < 0.0008) {
      v.dark = true;
      v.darkAt = Date.now();
      simDark.push({ mmsi: v.mmsi, kind: v.kind, lat, lon, lane: v.lane[0], t: Date.now() });
      ctx.alerts.fire('DARK SHIP', `${v.kind} MMSI ${v.mmsi} went dark in ${v.lane[0]}`, lat, lon);
    }
    if (v.dark) return;
    live.push({ v, lat, lon });
  });
  const pos = new Float32Array(live.length * 3);
  const meta = [];
  live.forEach((o, i) => {
    const p = ctx.llToV(o.lat, o.lon, ctx.R + 0.0015);
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = p.y;
    pos[i * 3 + 2] = p.z;
    meta.push({
      layer: 'SEA',
      sog: 8 + o.v.speed * 8000, // numeric for the UNDERWAY filter
      headline: `${o.v.kind} · MMSI ${o.v.mmsi}`,
      rows: {
        TYPE: 'VESSEL (SIMULATED)',
        LANE: o.v.lane[0],
        LAT: o.lat.toFixed(2) + '°',
        LON: o.lon.toFixed(2) + '°',
        SOG: (8 + o.v.speed * 8000).toFixed(1) + ' kt',
        SOURCE: 'Simulation — start the backend + AISSTREAM_KEY for live AIS',
      },
    });
  });
  ctx.setLive('SEA', pos, meta);

  const dpos = new Float32Array(simDark.length * 3);
  const dmeta = [];
  simDark.forEach((d, i) => {
    const p = ctx.llToV(d.lat, d.lon, ctx.R + 0.002);
    dpos[i * 3] = p.x;
    dpos[i * 3 + 1] = p.y;
    dpos[i * 3 + 2] = p.z;
    dmeta.push({
      layer: 'DARK',
      headline: `⚠ DARK — ${d.kind} MMSI ${d.mmsi}`,
      rows: {
        TYPE: 'AIS BLACKOUT',
        LANE: d.lane,
        'LAST LAT': d.lat.toFixed(2) + '°',
        'LAST LON': d.lon.toFixed(2) + '°',
        'WENT DARK': new Date(d.t).toUTCString(),
        NOTE: 'Transponder silent — possible evasion',
        SOURCE: 'Derived (sim)',
      },
    });
  });
  ctx.setLayerData('DARK', dpos, dmeta);
  ctx.ui.status('SEA', 'sim');
  ctx.ui.status('DARK', 'sim');
}

// SEA is the primary registered layer; DARK is a companion registered alongside.
export const DARK_DEF = {
  id: 'DARK',
  name: 'Dark Ships',
  color: 0xff2e2e,
  css: '#ff2e2e',
  oriented: true, // can render COG-aligned arrows (icon ➤); defaults to ⚠
  trail: true,
  trailOpts: { maxPoints: 12, maxAgeMs: 30 * 60e3 },
};

export default {
  id: 'SEA',
  name: 'Maritime AIS',
  color: 0x58d68d,
  css: '#58d68d',
  interval: CONFIG.SEA.refreshMs,
  oriented: true, // COG-aligned arrows (icon ➤, default for ships)
  trail: true,
  trailOpts: { maxPoints: 12, maxAgeMs: 20 * 60e3 },
  companions: [DARK_DEF], // extra layer IDs this module renders into

  init(ctx) {
    // Start the live relay. When it connects, it takes over; otherwise the
    // simulation (driven by load()) keeps running.
    connectMaritime({
      url: CONFIG.SEA.wsUrl,
      snapshotUrl: CONFIG.SEA.snapUrl,
      onUpdate: (vessels, dark) => {
        CONFIG.SEA.live = true;
        plotLive(ctx, vessels, dark);
      },
      onAlert: (a) => ctx.alerts.fire(a.title, a.msg, a.lat, a.lon, a.mmsi != null ? { mmsi: a.mmsi } : null),
      onStatus: (s) => {
        if (s === 'ok') {
          ctx.ui.status('SEA', 'ok');
          ctx.ui.status('DARK', 'ok');
          ctx.ui.tick('Live AIS relay connected — real vessel tracking active');
        } else if (s === 'down') {
          CONFIG.SEA.live = false;
          ctx.ui.status('SEA', 'sim');
          ctx.ui.status('DARK', 'sim');
          ctx.ui.tick('AIS relay unreachable — using maritime simulation');
        } else {
          ctx.ui.status('SEA', 'wait');
        }
      },
    });
  },

  load(ctx) {
    simulate(ctx);
  },
};
