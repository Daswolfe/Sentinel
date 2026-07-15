import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';
import { TrailSet, chevronGeometry, quadGeometry, directionalIconTexture, arrowMatrix } from './markers.js';

// Icons that render as heading-ORIENTED instanced markers (rotate to travel
// direction) instead of flat point sprites, on layers with `oriented:true`:
//   ➤ solid chevron   ✈ fixed-wing silhouette   🚁 helicopter silhouette
export const DIRECTIONAL = { '➤': 'chevron', '✈': 'plane', '🚁': 'heli' };
export const ARROW_ICON = '➤';
const orientedKind = (glyph) => DIRECTIONAL[glyph] || null;

const _mat4 = new THREE.Matrix4(); // reused per-instance transform (no per-plot alloc)

// Layers the density cap applies to — the bulky movers. Cartography, alerts,
// and sparse event layers always plot in full.
const DENSITY_CAPPED = new Set(['SAT', 'AIR', 'MILAIR', 'SEA']);

/**
 * Layer architecture
 * ──────────────────
 * Every data source is a module in ./layers/ that exports a definition:
 *
 *   export default {
 *     id: 'QUAKE',                       // unique key
 *     name: 'Seismic',                   // sidebar label
 *     color: 0xff5d5d, css: '#ff5d5d',   // point + swatch colour
 *     size: 5,                           // optional point size (default 3.4)
 *     disabled: false, tag: null,        // start hidden? sidebar tag (SIM/KEY/…)
 *     interval: 5*60e3,                  // optional auto-refresh period (ms)
 *     async load(ctx) { … },             // fetch + plot (called on start + interval)
 *     onScrub(ctx, t) { … },             // optional: re-render for the 4D scrubber
 *     onRegion(ctx) { … },               // optional: react to region focus change
 *   }
 *
 * The `ctx` handed to every hook is the LayerContext below. A layer never
 * touches a global — everything it needs (plotting, geo, ui, alerts, region
 * state, the live store) comes through ctx. That's what makes layers droppable:
 * add a file, register it, done.
 */

export class LayerContext {
  constructor({ scene, ui, alerts, getRegion, getScrubT }) {
    this.scene = scene;
    this.ui = ui;
    this.alerts = alerts;
    this.THREE = THREE;
    this.R = GLOBE_R;
    this.llToV = llToV;
    this._getRegion = getRegion;
    this._getScrubT = getScrubT;
    this.layers = new Map();   // id -> { def, points, meta[], visible }
    this.live = new Map();     // id -> { pos, meta }  (for the 4D scrubber)
    this.markerScale = 1.2;    // base arrow world-size, refreshed from altitude
    // Per-layer size is def.iconScale (default 1), set via setLayerSize.
  }

  // Current region focus object (or null for global). Read-only for layers.
  region() {
    return this._getRegion();
  }

  // Current scrub time in epoch ms, or null when live.
  scrubTime() {
    return this._getScrubT();
  }

  _register(def) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    // Fixed conservative bounds: points are never frustum-culled, but
    // Points.raycast() would force an O(n) computeBoundingSphere() on every
    // geometry swap without this. Radius covers everything up to GEO orbit.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 800);
    const mat = new THREE.PointsMaterial({
      color: def.color,
      size: def.size ?? 3.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    // disabled = greyed out, not toggleable (stubs); defaultOff = starts
    // unchecked but the user can switch it on (e.g. Cities).
    const visible = !def.disabled && !def.defaultOff;
    points.visible = visible;
    const L = { def, points, meta: [], visible };
    // Ghost trail (aircraft, ships, satellites): short fading breadcrumb.
    if (def.trail) {
      L.trail = new TrailSet(this.scene, def.color, def.trailOpts);
      L.trail.setVisible(visible);
    }
    // Oriented layers can render heading-aligned arrows instead of dots.
    if (def.oriented) L.arrowMax = 0; // InstancedMesh built lazily on first plot
    this.layers.set(def.id, L);
  }

  // One base geometry per marker kind, shared by every layer and every
  // capacity rebuild (only the InstancedMesh's instance buffer is per-layer).
  static _arrowGeo = new Map();
  static _arrowGeoFor(kind) {
    let g = this._arrowGeo.get(kind);
    if (!g) this._arrowGeo.set(kind, (g = kind === 'chevron' ? chevronGeometry() : quadGeometry()));
    return g;
  }

  // Grow (or create) a layer's oriented-marker InstancedMesh to hold `count`
  // markers. Rebuilt when capacity is exceeded OR the icon kind changed
  // (chevron ⇄ textured plane/heli need different geometry + material).
  _ensureArrow(L, count) {
    const kind = orientedKind(L.def.icon) || 'chevron';
    if (L.arrow && count <= L.arrowMax && L.arrowKind === kind) return L.arrow;
    if (L.arrow) {
      this.scene.remove(L.arrow);
      L.arrow.material.dispose(); // geometry is shared — never disposed
      L.arrow.dispose(); // frees the instance buffer
    }
    const max = Math.max(1, Math.ceil(count * 1.5));
    const color = L.def.css || L.def.color;
    const geo = LayerContext._arrowGeoFor(kind);
    const mat =
      kind === 'chevron'
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({
            map: directionalIconTexture(kind),
            color,
            transparent: true,
            alphaTest: 0.35,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.frustumCulled = false;
    mesh.visible = L.visible;
    this.scene.add(mesh);
    L.arrow = mesh;
    L.arrowMax = max;
    L.arrowKind = kind;
    return mesh;
  }

  // Plot positions (Float32Array xyz triples) + parallel meta[] for a layer.
  // The raw frame is kept so an active region focus can be applied (and
  // re-applied when the region changes) without refetching.
  setLayerData(id, positions, meta) {
    const L = this.layers.get(id);
    if (!L) return;
    L.raw = { pos: positions, meta };
    this._plot(L);
  }

  _plot(L) {
    let { pos, meta } = L.raw;
    const region = this._getRegion();
    if (region?.bbox) ({ pos, meta } = this._regionFilter(L.def.id, pos, meta, region));
    // Contact filter (nationality / mil-civ / watchlist), set by the host UI.
    if (this.contactFilter) {
      const keepPos = [], keepMeta = [];
      for (let i = 0; i < meta.length; i++) {
        if (!this.contactFilter(meta[i], L.def.id)) continue;
        keepPos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        keepMeta.push(meta[i]);
      }
      if (keepMeta.length !== meta.length) {
        pos = new Float32Array(keepPos);
        meta = keepMeta;
      }
    }
    // Density cap: over the limit, keep the top-N by relevance instead of an
    // arbitrary slice. Only the bulky mover layers participate; the host sets
    // densityCap + relevance (contactFilters) like it sets contactFilter.
    if (this.densityCap && this.relevance && DENSITY_CAPPED.has(L.def.id) && meta.length > this.densityCap) {
      const scored = meta.map((m, i) => [this.relevance(m, L.def.id), i]);
      scored.sort((a, b) => b[0] - a[0]);
      const keepPos = new Float32Array(this.densityCap * 3);
      const keepMeta = new Array(this.densityCap);
      for (let k = 0; k < this.densityCap; k++) {
        const i = scored[k][1];
        keepPos.set(pos.subarray(i * 3, i * 3 + 3), k * 3);
        keepMeta[k] = meta[i];
      }
      pos = keepPos;
      meta = keepMeta;
    }
    // Upload into a persistent capacity-grown buffer instead of swapping in a
    // fresh BufferAttribute per plot: at 10k+ vessels every 2 s, allocating
    // new Float32Arrays (+ an O(n) computeBoundingSphere — the fixed sphere
    // from _register covers raycasting) was megabytes/second of GC churn.
    const geo = L.points.geometry;
    let attr = geo.attributes.position;
    if (attr.array.length < pos.length) {
      attr = new THREE.BufferAttribute(new Float32Array(Math.ceil(meta.length * 1.5) * 3), 3);
      geo.setAttribute('position', attr);
    }
    attr.array.set(pos);
    attr.needsUpdate = true;
    geo.setDrawRange(0, meta.length);
    L.meta = meta;
    this.ui.count(L.def.id, meta.length);

    // Ghost trails: push each plotted contact's position, keyed by a stable id.
    // Only in live mode — scrubbing replays historical frames, which would
    // otherwise poison the live breadcrumb history.
    if (L.trail && this._getScrubT() === null) {
      const alive = new Set();
      for (let i = 0; i < meta.length; i++) {
        const m = meta[i];
        // Needs a STABLE, unique per-contact key. Falling back to headline is
        // unsafe for satellites (blank/duplicate names in the catalog collide
        // into one polyline that zig-zags between different objects) — so layers
        // set an explicit m.trailId (NORAD number for SAT).
        const id = m.trailId ?? m.icao ?? m.mmsi ?? m.headline ?? i;
        alive.add(id);
        L.trail.push(id, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      }
      L.trail.rebuild(alive);
    }

    // Directional-arrow render mode (heading-oriented chevrons) vs point sprites.
    const arrowMode = L.def.oriented && !!orientedKind(L.def.icon);
    if (arrowMode) {
      const mesh = this._ensureArrow(L, meta.length);
      const scale = this.markerScale * (L.def.iconScale ?? 1);
      for (let i = 0; i < meta.length; i++) {
        arrowMatrix(_mat4, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], meta[i].heading, scale);
        mesh.setMatrixAt(i, _mat4);
      }
      mesh.count = meta.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = L.visible;
      L.arrowScale = scale;
      L.points.visible = false;
    } else if (L.arrow) {
      L.arrow.visible = false;
      L.points.visible = L.visible;
    }
  }

  // Re-scale arrow markers when the camera altitude changes materially, so
  // chevrons stay readable through a zoom instead of waiting for the next
  // data refresh. Called (throttled) from the render loop; cheap no-op when
  // the scale hasn't moved >12%.
  rescaleArrows() {
    const force = this._forceRescale; // e.g. a layer's size slider moved
    this._forceRescale = false;
    for (const L of this.layers.values()) {
      if (!L.arrow || !L.arrow.visible || !L.meta.length) continue;
      const s = this.markerScale * (L.def.iconScale ?? 1);
      const prev = L.arrowScale || s;
      if (!force && Math.abs(s - prev) / prev < 0.12) continue;
      const pos = L.points.geometry.attributes.position.array;
      for (let i = 0; i < L.meta.length; i++) {
        arrowMatrix(_mat4, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], L.meta[i].heading, s);
        L.arrow.setMatrixAt(i, _mat4);
      }
      L.arrow.instanceMatrix.needsUpdate = true;
      L.arrowScale = s;
    }
  }

  // Region focus: drop points originating outside the bbox — except satellites,
  // which are kept if they have line of sight to the region centre (a sat over
  // the horizon can't see the region; one 30° of longitude away might).
  _regionFilter(id, pos, meta, region) {
    const n = meta.length;
    const keepPos = [];
    const keepMeta = [];
    const uLat = (region.lat * Math.PI) / 180;
    const uLon = (region.lon * Math.PI) / 180;
    const [lamin, lomin, lamax, lomax] = region.bbox;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      let keep;
      if (id === 'SAT') {
        // LOS: angular separation between subpoints ≤ horizon angle acos(Re/(Re+alt)).
        const m = meta[i];
        const sLat = ((m.lat ?? 0) * Math.PI) / 180;
        const sLon = ((m.lon ?? 0) * Math.PI) / 180;
        const cosSep =
          Math.sin(uLat) * Math.sin(sLat) +
          Math.cos(uLat) * Math.cos(sLat) * Math.cos(sLon - uLon);
        keep = cosSep >= 6371 / (6371 + (m.altKm ?? 500));
      } else if (meta[i].lat != null) {
        // Every layer records its source lat/lon in meta — no per-point trig.
        const { lat, lon } = meta[i];
        keep = lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax;
      } else {
        // Fallback for meta without coordinates: invert llToV (sqrt/acos/atan2).
        const r = Math.sqrt(x * x + y * y + z * z) || 1;
        const lat = 90 - (Math.acos(y / r) * 180) / Math.PI;
        let lon = (Math.atan2(z, -x) * 180) / Math.PI - 180;
        if (lon < -180) lon += 360;
        keep = lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax;
      }
      if (keep) {
        keepPos.push(x, y, z);
        keepMeta.push(meta[i]);
      }
    }
    return { pos: new Float32Array(keepPos), meta: keepMeta };
  }

  // Re-apply the region filter to every layer's last raw frame (region changed).
  refilterAll() {
    for (const L of this.layers.values()) if (L.raw) this._plot(L);
  }

  // Like setLayerData, but records the frame in the live store so the 4D
  // scrubber can replay it. Layers that should be time-scrubbable use this.
  setLive(id, positions, meta) {
    this.live.set(id, { pos: positions, meta });
    if (this._getScrubT() === null) this.setLayerData(id, positions, meta);
  }

  // Re-apply the most recent live frame (used when leaving scrub → live).
  restoreLive(id) {
    const l = this.live.get(id);
    if (l) this.setLayerData(id, l.pos, l.meta);
  }

  setVisible(id, on) {
    const L = this.layers.get(id);
    if (!L) return;
    L.visible = on;
    const arrowMode = L.def.oriented && !!orientedKind(L.def.icon);
    L.points.visible = on && !arrowMode;
    if (L.arrow) L.arrow.visible = on && arrowMode;
    if (L.trail) L.trail.setVisible(on);
  }

  // Recolour a layer's points/arrows/trail at runtime (sidebar swatch).
  setLayerColor(id, css) {
    const L = this.layers.get(id);
    if (!L) return;
    L.def.css = css;
    L.points.material.color.set(css);
    if (L.arrow) L.arrow.material.color.set(css);
    if (L.trail) L.trail.setColor(css);
  }

  // Point-sprite icon shapes. Glyphs are rasterized white once (cached) so
  // the layer colour keeps tinting them; '●' means the plain square dot.
  static _iconCache = new Map();
  static _iconTex(glyph) {
    if (this._iconCache.has(glyph)) return this._iconCache.get(glyph);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    if (glyph === '╳') {
      // Airport: two crossed runways (a clearer map symbol than any font glyph).
      g.translate(32, 32);
      for (const ang of [Math.PI / 5, -Math.PI / 5]) {
        g.save();
        g.rotate(ang);
        g.fillRect(-5, -26, 10, 52);
        g.restore();
      }
    } else {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '52px "Segoe UI Symbol","Noto Sans Symbols",sans-serif';
      // ︎ forces text (monochrome) presentation so the tint applies.
      g.fillText(glyph + '︎', 32, 36);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._iconCache.set(glyph, tex);
    return tex;
  }

  setLayerIcon(id, glyph) {
    const L = this.layers.get(id);
    if (!L) return;
    L.def.icon = glyph;
    // Directional-arrow mode is handled at plot time; re-plot so the swap
    // between points and arrows takes effect immediately.
    if (L.def.oriented && !!orientedKind(glyph)) {
      if (L.raw) this._plot(L);
      return;
    }
    if (L.arrow) L.arrow.visible = false;
    L.points.visible = L.visible;
    const mat = L.points.material;
    const scale = L.def.iconScale ?? 1;
    if (!glyph || glyph === '●') {
      mat.map = null;
      mat.alphaTest = 0;
      mat.size = (L.def.size ?? 3.4) * scale;
    } else {
      mat.map = LayerContext._iconTex(glyph);
      mat.alphaTest = 0.2;
      mat.size = (L.def.size ?? 3.4) * 2.8 * scale;
    }
    mat.needsUpdate = true;
    if (L.raw) this._plot(L);
  }

  // Base screen-pixel size of a layer's point sprite (dot vs glyph), before the
  // per-layer size multiplier.
  _basePointSize(def) {
    return (def.size ?? 3.4) * (!def.icon || def.icon === '●' ? 1 : 2.8);
  }

  // Per-layer icon-size multiplier (from the layer's style menu). Point sprites
  // resize immediately; heading arrows pick it up on the next render-loop rescale.
  setLayerSize(id, scale) {
    const L = this.layers.get(id);
    if (!L) return;
    L.def.iconScale = scale;
    L.points.material.size = this._basePointSize(L.def) * scale;
    L.points.material.needsUpdate = true;
    this._forceRescale = true; // arrows must rescale even for a <12% step
  }

  // Objects that should be hit-tested by the picker: the point cloud, or the
  // arrow InstancedMesh when a layer is in arrow mode. Returns [{obj, L}].
  pickTargets() {
    const out = [];
    for (const L of this.layers.values()) {
      if (!L.visible || !L.meta.length) continue;
      const arrowMode = L.def.oriented && !!orientedKind(L.def.icon);
      if (arrowMode && L.arrow) out.push({ obj: L.arrow, L });
      else out.push({ obj: L.points, L });
    }
    return out;
  }

  metaFor(id) {
    return this.layers.get(id)?.meta ?? [];
  }
}

/**
 * LayerRegistry — owns the set of layer modules, wires their timers, and fans
 * scrub/region events out to any layer that cares.
 */
export class LayerRegistry {
  constructor(ctx) {
    this.ctx = ctx;
    this.defs = [];
    this.timers = [];
  }

  add(def) {
    this.defs.push(def);
    this.ctx._register(def);
    // Some modules render into extra layer IDs (e.g. SEA also drives DARK).
    for (const c of def.companions ?? []) this.ctx._register(c);
    return this;
  }

  addAll(defs) {
    for (const d of defs) this.add(d);
    return this;
  }

  // Give every layer a chance to set up scene objects / connections once.
  init() {
    for (const def of this.defs) def.init?.(this.ctx);
  }

  // Kick off initial load + auto-refresh for every layer.
  // `lazy` layers (heavy, default-off — e.g. bike share) skip this and load
  // themselves on first enable via their own onVisible hook.
  start() {
    for (const def of this.defs) {
      if (typeof def.load === 'function' && !def.lazy) {
        Promise.resolve(def.load(this.ctx)).catch(() =>
          this.ctx.ui.tick(`${def.id} load error`),
        );
        if (def.interval) {
          const t = setInterval(
            () => Promise.resolve(def.load(this.ctx)).catch(() => {}),
            def.interval,
          );
          this.timers.push({ id: def.id, t });
        }
      }
    }
  }

  // Per-frame-ish tick for layers that recompute continuously (e.g. satellites).
  tickAll() {
    for (const def of this.defs) def.tick?.(this.ctx);
  }

  get(id) {
    return this.defs.find((d) => d.id === id);
  }

  // Reload one layer now (used when region focus changes its query).
  reload(id) {
    const def = this.defs.find((d) => d.id === id);
    if (def?.load) Promise.resolve(def.load(this.ctx)).catch(() => {});
  }

  // Change a layer's refresh cadence at runtime (e.g. faster in a region).
  setInterval(id, ms) {
    const existing = this.timers.find((x) => x.id === id);
    if (existing) clearInterval(existing.t);
    const def = this.defs.find((d) => d.id === id);
    if (!def?.load) return;
    const t = setInterval(() => Promise.resolve(def.load(this.ctx)).catch(() => {}), ms);
    if (existing) existing.t = t;
    else this.timers.push({ id, t });
  }

  notifyScrub(t) {
    for (const def of this.defs) def.onScrub?.(this.ctx, t);
  }

  notifyRegion() {
    for (const def of this.defs) def.onRegion?.(this.ctx);
  }

  defsList() {
    return this.defs;
  }
}
