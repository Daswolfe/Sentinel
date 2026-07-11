import { CONFIG } from '../config.js';

// NASA FIRMS thermal anomalies. Needs a free MAP_KEY. Region-aware: narrows
// the query box to the active region to save quota.
//
// The raw feed is tens of thousands of pixels — every gas flare, crop burn
// and warm rooftop. We keep a detection only if it looks like a real fire:
// FRP (fire radiative power, MW) ≥ minFrp, or brightness temperature ≥
// minBright when FRP is missing, and confidence not "low". Tune in
// CONFIG.FIRMS.

// Plain-English context for the detail panel. FRP→area equivalences are
// rough order-of-magnitude, but they anchor the number.
function frpContext(frp) {
  if (frp == null || isNaN(frp)) return null;
  if (frp < 5) return 'small burn / gas flare';
  if (frp < 25) return 'significant fire (≈ 1–10 acres)';
  if (frp < 100) return 'large fire (≈ 10–100 acres)';
  if (frp < 500) return 'major wildfire (≈ 100+ acres)';
  return 'extreme fire event (multi-front wildfire scale)';
}
function brightContext(k) {
  if (k == null || isNaN(k)) return null;
  if (k < 330) return 'smoldering / residual heat';
  if (k < 360) return 'active flaming';
  return 'intense combustion (saturated sensor)';
}

export default {
  id: 'FIRMS',
  name: 'Thermal/Fire',
  color: 0xffd24a,
  css: '#ffd24a',
  interval: CONFIG.FIRMS.refreshMs,

  async load(ctx) {
    ctx.ui.status('FIRMS', 'wait');
    try {
      const bbox = ctx.region()?.bbox;
      const box = bbox
        ? `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`
        : '-180,-90,180,90';
      const u =
        `${CONFIG.FIRMS.url}?source=${CONFIG.FIRMS.source}&box=${box}&days=${CONFIG.FIRMS.days}`;
      const text = (await (await fetch(u)).text()).trim();
      // Empty body = backend has no FIRMS_MAP_KEY set → report OFF, not error.
      if (!text) {
        ctx.setLayerData('FIRMS', new Float32Array(0), []);
        ctx.ui.status('FIRMS', 'off');
        return;
      }
      const csv = text.split('\n');
      const head = csv[0].split(',');
      const la = head.indexOf('latitude');
      const lo = head.indexOf('longitude');
      const br = head.indexOf('bright_ti4');
      const fr = head.indexOf('frp');
      const cf = head.indexOf('confidence');
      const dn = head.indexOf('daynight');
      const all = csv.slice(1);
      const rows = [];
      for (const r of all) {
        const c = r.split(',');
        if (c[cf] === 'l') continue; // low-confidence pixel
        const frp = +c[fr];
        const bright = +c[br];
        if (!(frp >= CONFIG.FIRMS.minFrp || (!isFinite(frp) && bright >= CONFIG.FIRMS.minBright)))
          continue;
        rows.push(c);
      }
      const pos = new Float32Array(rows.length * 3);
      const meta = [];
      rows.forEach((c, i) => {
        const lat = +c[la];
        const lon = +c[lo];
        const frp = +c[fr];
        const bright = +c[br];
        const v = ctx.llToV(lat, lon, ctx.R + 0.055);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'FIRMS',
          lat,
          lon,
          headline: `Fire — ${frpContext(frp) ?? brightContext(bright) ?? 'thermal anomaly'}`,
          rows: {
            TYPE: 'THERMAL/FIRE',
            'FIRE POWER': isFinite(frp) ? `${frp.toFixed(0)} MW — ${frpContext(frp)}` : '—',
            BRIGHTNESS: isFinite(bright) ? `${bright.toFixed(0)} K — ${brightContext(bright)}` : '—',
            CONFIDENCE: { h: 'high', n: 'nominal', l: 'low' }[c[cf]] ?? c[cf] ?? '—',
            'DAY/NIGHT': c[dn] === 'D' ? 'day pass' : 'night pass',
            LAT: lat.toFixed(2) + '°',
            LON: lon.toFixed(2) + '°',
            SOURCE: 'NASA FIRMS ' + CONFIG.FIRMS.source,
          },
        });
      });
      ctx.setLayerData('FIRMS', pos, meta);
      ctx.ui.status('FIRMS', 'ok');
      ctx.ui.info(
        `FIRMS — ${rows.length} significant fires (of ${all.length} raw detections, FRP ≥ ${CONFIG.FIRMS.minFrp} MW)`,
      );
    } catch (e) {
      ctx.ui.status('FIRMS', 'err');
    }
  },

  onRegion(ctx) {
    this.load(ctx);
  },
};
