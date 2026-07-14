import { CONFIG } from '../config.js';

// Maritime boundaries (Theme 3.11) — Marine Regions "Maritime Boundaries" v12,
// preprocessed into a compact polyline index by server/data/convert-maritime.mjs
// and served by the backend at /api/maritime. Four line classes, each merged
// into a single LineSegments draw call:
//   EEZ      — settled EEZ delimitation lines (treaty / median / 200 NM / court)
//   DISPUTED — unsettled or overlapping-claim lines (the intel-relevant ones)
//   24 NM    — contiguous-zone outer limits
//   12 NM    — territorial-sea outer limits
// Static cartography, so default-off + lazy: fetched once on first enable.

const CLASSES = [
  { key: 'eez',      color: 0x3b86d8, opacity: 0.5 },
  { key: 'disputed', color: 0xff5d5d, opacity: 0.85 },
  { key: 'nm24',     color: 0x8a7ad8, opacity: 0.28 },
  { key: 'nm12',     color: 0x2fb7a0, opacity: 0.45 },
];

export default {
  id: 'BOUND',
  name: 'Sea Boundaries',
  color: 0x3b86d8,
  css: '#3b86d8',
  defaultOff: true,
  lazy: true, // static data — one fetch on first enable, no refresh timer

  init(ctx) {
    this._ctx = ctx;
    this.grp = new ctx.THREE.Group();
    this.grp.visible = false;
    ctx.scene.add(this.grp);
    ctx.ui.status('BOUND', 'off');
  },

  onVisible(on) {
    this.grp.visible = on;
    if (on && !this._loaded) {
      this._loaded = true;
      this.load(this._ctx);
    }
  },

  async load(ctx) {
    ctx.ui.status('BOUND', 'wait');
    try {
      const j = await (await fetch(CONFIG.BOUNDARIES.url)).json();
      const { THREE } = ctx;
      const R = ctx.R + 0.025; // under the coastline strokes — borders win ties
      let lines = 0;
      for (const { key, color, opacity } of CLASSES) {
        const polys = j[key] || [];
        lines += polys.length;
        // Merge the whole class into one LineSegments: (n-1) segments per line.
        let segs = 0;
        for (const p of polys) segs += p.length - 1;
        const pos = new Float32Array(segs * 6);
        let o = 0;
        for (const p of polys) {
          let prev = ctx.llToV(p[0][0], p[0][1], R);
          for (let i = 1; i < p.length; i++) {
            const cur = ctx.llToV(p[i][0], p[i][1], R);
            pos[o] = prev.x; pos[o + 1] = prev.y; pos[o + 2] = prev.z;
            pos[o + 3] = cur.x; pos[o + 4] = cur.y; pos[o + 5] = cur.z;
            o += 6;
            prev = cur;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.grp.add(
          new THREE.LineSegments(
            geo,
            new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
          ),
        );
      }
      ctx.ui.count('BOUND', lines);
      ctx.ui.status('BOUND', 'ok');
      ctx.ui.info('Sea boundaries — EEZ blue · disputed red · 24nm violet · 12nm teal (Marine Regions)');
    } catch (e) {
      this._loaded = false; // allow a retry on next toggle
      ctx.ui.status('BOUND', 'err');
    }
  },
};
