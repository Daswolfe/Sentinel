import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLOBE_R, llToV } from './globe.js';
import { CONFIG } from './config.js';

// 3D buildings/cities at deep zoom — Phase D + Theme 3.13.
//
// TWO providers behind one interface (update/tick/setEnabled):
//
//  • Google Photorealistic 3D Tiles (preferred) — used automatically when the
//    backend /config reports a GOOGLE_MAPS_KEY. A 3d-tiles-renderer TilesRenderer
//    streams the photorealistic mesh straight from Google; we re-frame its ECEF
//    output onto our display sphere (see _anchorMatrix). Requires attaching the
//    camera + renderer (attachView) and a per-frame tick().
//
//  • OSM Buildings (fallback) — z15 GeoJSON footprints extruded into one merged
//    prism mesh per tile. Keyless, CORS-open, works offline-ish.
//
// If the Google tileset errors before first success (bad/missing key, quota),
// we dispose it and fall back to OSM silently.

const M2U = 1 / 63710; // metres → globe units (1 unit = 63.71 km)
const Z = 15;

// WGS84 → ECEF (metres). Google tiles live in this frame.
function ecefOf(latDeg, lonDeg) {
  const a = 6378137, e2 = 6.69437999014e-3;
  const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
  const sLa = Math.sin(la), cLa = Math.cos(la);
  const N = a / Math.sqrt(1 - e2 * sLa * sLa);
  return {
    p: new THREE.Vector3(N * cLa * Math.cos(lo), N * cLa * Math.sin(lo), N * (1 - e2) * sLa),
    east: new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0),
    north: new THREE.Vector3(-sLa * Math.cos(lo), -sLa * Math.sin(lo), cLa),
    up: new THREE.Vector3(cLa * Math.cos(lo), cLa * Math.sin(lo), sLa),
  };
}

export class BuildingsOverlay {
  constructor(scene, onStatus = () => {}) {
    this.scene = scene;
    this.onStatus = onStatus;
    this.enabled = true;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tiles = new Map(); // OSM: "x,y" -> { mesh | null(pending/empty), at }
    this.active = false;
    this.gen = 0;
    // Google provider state — key arrives async; provider builds lazily on
    // first deep zoom so users who never dive pay nothing. Only wired up when
    // CONFIG.BUILDINGS.provider === 'google' (experimental — see config.js).
    this._googleKey = null;
    this._g = null;          // TilesRenderer once built
    this._anchor = null;     // { lat, lon } of the current ENU anchor
    if (CONFIG.BUILDINGS.provider === 'google')
      fetch('/api/config')
        .then((r) => r.json())
        .then((j) => { if (j.googleMapsKey) this._googleKey = j.googleMapsKey; })
        .catch(() => {});
  }

  // Google tiles need the live camera + renderer for screen-space error.
  attachView(camera, renderer) {
    this._camera = camera;
    this._renderer = renderer;
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    if (!on) this._setActive(false);
  }

  _setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this.onStatus(on);
    if (this._attrib) this._attrib.style.display = on && this._g ? 'block' : 'none';
  }

  // Called with the camera's ground point once it settles (same cadence as the
  // imagery tile patch).
  update(lat, lon, altUnits) {
    if (!this.enabled || altUnits > CONFIG.BUILDINGS.showBelow) {
      this._setActive(false);
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (this._googleKey && this._camera) return this._updateGoogle(lat, lon);
    this._updateOsm(lat, lon);
  }

  // Per-frame hook (from the render loop). Only the Google provider needs it.
  tick() {
    if (!this._g || !this.group.visible || !this.enabled) return;
    this._camera.updateMatrixWorld();
    this._g.setResolutionFromRenderer(this._camera, this._renderer);
    this._g.update();
    const now = Date.now();
    if (now - (this._attribAt || 0) > 1000) {
      this._attribAt = now;
      const parts = [];
      this._g.getAttributions(parts);
      this._attrib.textContent =
        'Photorealistic 3D · ' + (parts.map((p) => p.value).join(' · ') || '© Google');
    }
  }

  /* ── Google Photorealistic 3D Tiles ─────────────────────────────── */

  _updateGoogle(lat, lon) {
    if (!this._g) {
      this._gateGoogle(); // async — imagery covers the view while it resolves
      if (!this._g) return;
    }
    // Re-anchor when the view wanders far enough that the sphere/ellipsoid
    // residual would show (~0.5° ≈ 55 km).
    const a = this._anchor;
    if (!a || Math.abs(lat - a.lat) + Math.abs(lon - a.lon) * Math.cos((lat * Math.PI) / 180) > 0.5) {
      this._anchor = { lat, lon };
      this._anchorGrp.matrix.copy(this._anchorMatrix(lat, lon));
      this._anchorGrp.matrixWorld.copy(this._anchorGrp.matrix); // matrixAutoUpdate off
    }
    this._setActive(true);
  }

  // Billing gate: a Google 3D Tiles session costs one root tileset request
  // (the billable unit — 1,000 free/month). The backend meters those; only
  // build the TilesRenderer if it issues a ticket, else stay on OSM. With
  // autoRefreshToken off, session creation is the ONLY code path that can
  // reach Google's root endpoint, so the meter can't be bypassed.
  async _gateGoogle() {
    if (this._g || this._gatePending || !this._googleKey) return;
    this._gatePending = true;
    try {
      const j = await (await fetch('/api/tiles-session', { method: 'POST' })).json();
      if (!j.ok) {
        this._googleKey = null; // monthly cap reached — OSM for the rest of the session
        return;
      }
      this._ensureGoogle();
    } catch {
      this._googleKey = null;
    } finally {
      this._gatePending = false;
    }
  }

  _ensureGoogle() {
    if (this._g) return true;
    try {
      const tiles = new TilesRenderer();
      tiles.registerPlugin(
        new GoogleCloudAuthPlugin({ apiToken: this._googleKey, autoRefreshToken: false }),
      );
      const draco = new DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
      tiles.setCamera(this._camera);
      tiles.setResolutionFromRenderer(this._camera, this._renderer);
      tiles.errorTarget = 20; // photorealistic: favour framerate over crispness
      tiles.addEventListener('load-error', () => {
        // Never rendered anything → bad key / quota refused: OSM fallback.
        if (!this._gLoaded) return this._disposeGoogle();
        // A healthy session that starts failing en masse after a long time is
        // an expired session token (auto-refresh is off so it stays metered).
        // Rebuild through the billing gate — at most 3 times per page load.
        this._errs = (this._errs || 0) + 1;
        if (
          this._errs > 10 &&
          Date.now() - this._gBornAt > 30 * 60e3 &&
          (this._rebuilds = (this._rebuilds || 0) + 1) <= 3
        ) {
          const key = this._googleKey;
          this._disposeGoogle();
          this._googleKey = key; // next update() re-gates for a fresh session
        }
      });
      tiles.addEventListener('load-model', () => {
        this._gLoaded = true;
        this._errs = 0;
      });
      this._gBornAt = Date.now();
      this._anchorGrp = new THREE.Group();
      this._anchorGrp.matrixAutoUpdate = false;
      this._anchorGrp.add(tiles.group);
      this.group.add(this._anchorGrp);
      this._g = tiles;
      // Required attribution overlay (Google ToS): copyright + provider badge.
      this._attrib = document.createElement('div');
      this._attrib.style.cssText =
        'position:fixed;right:10px;bottom:46px;z-index:6;pointer-events:none;' +
        'font:10px/1.4 "JetBrains Mono",monospace;color:#9fb6c8;opacity:0.75;' +
        'text-shadow:0 1px 2px #000;display:none;max-width:46vw;text-align:right';
      document.body.appendChild(this._attrib);
      return true;
    } catch {
      this._googleKey = null;
      return false;
    }
  }

  _disposeGoogle() {
    if (!this._g) return;
    this.group.remove(this._anchorGrp);
    this._g.dispose();
    this._g = null;
    this._googleKey = null; // don't retry — OSM takes over from here
    this._gLoaded = false;
    this._anchor = null;
    this._attrib?.remove();
    this._attrib = null;
  }

  // Map the tileset's ECEF frame onto our display sphere: align the local
  // east/north/up triad at the WGS84 anchor with the same triad at the
  // GLOBE_R surface point, and scale metres → globe units. Exact at the
  // anchor; the ellipsoid-vs-sphere residual grows with distance (cm–m per
  // km), which re-anchoring keeps invisible at city scale.
  _anchorMatrix(lat, lon) {
    const e = ecefOf(lat, lon);
    const anchor = llToV(lat, lon, GLOBE_R);
    const up = anchor.clone().normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
    east.normalize();
    const north = up.clone().cross(east);
    const rot = new THREE.Matrix4()
      .makeBasis(east, north, up) // our-frame ENU columns
      .multiply(new THREE.Matrix4().makeBasis(e.east, e.north, e.up).transpose());
    return new THREE.Matrix4()
      .makeTranslation(-e.p.x, -e.p.y, -e.p.z)
      .premultiply(rot)
      .premultiply(new THREE.Matrix4().makeScale(M2U, M2U, M2U))
      .premultiply(new THREE.Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z));
  }

  /* ── OSM Buildings fallback (extruded footprints) ───────────────── */

  _updateOsm(lat, lon) {
    const n = 2 ** Z;
    const latR = (lat * Math.PI) / 180;
    const cx = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
    const merc = Math.log(Math.tan(latR) + 1 / Math.cos(latR));
    const cy = Math.min(n - 1, Math.max(0, Math.floor(((1 - merc / Math.PI) / 2) * n)));
    const g = CONFIG.BUILDINGS.grid;
    const half = Math.floor(g / 2);
    const wanted = new Set();
    for (let dy = -half; dy <= half; dy++)
      for (let dx = -half; dx <= half; dx++) {
        const x = (((cx + dx) % n) + n) % n;
        const y = Math.min(n - 1, Math.max(0, cy + dy));
        const key = `${x},${y}`;
        wanted.add(key);
        if (!this.tiles.has(key)) this._loadTile(x, y, key);
      }
    // Evict tiles far outside the window (keep a small halo for pan-back).
    if (this.tiles.size > g * g * 4) {
      for (const [key, t] of this.tiles) {
        if (wanted.has(key)) continue;
        if (t.mesh) {
          this.group.remove(t.mesh);
          t.mesh.geometry.dispose();
        }
        this.tiles.delete(key);
        if (this.tiles.size <= g * g * 2) break;
      }
    }
  }

  async _loadTile(x, y, key) {
    this.tiles.set(key, { mesh: null, at: Date.now() }); // reserve (also = "empty")
    const url = CONFIG.BUILDINGS.url
      .replace('{k}', CONFIG.BUILDINGS.key)
      .replace('{z}', Z)
      .replace('{x}', x)
      .replace('{y}', y);
    let gj;
    try {
      const r = await fetch(url);
      if (!r.ok) return; // 204/403/океан — leave as empty
      gj = await r.json();
    } catch {
      return;
    }
    if (!this.enabled || !gj?.features?.length) return;
    const mesh = this._buildTile(gj, x, y);
    if (!mesh) return;
    const t = this.tiles.get(key);
    if (!t) {
      mesh.geometry.dispose();
      return; // evicted while loading
    }
    t.mesh = mesh;
    this.group.add(mesh);
    this._setActive(true);
  }

  // Extrude every footprint in the tile into one merged prism geometry, built
  // in a local ENU frame anchored at the tile centre.
  _buildTile(gj, x, y) {
    const n = 2 ** Z;
    const lon0 = ((x + 0.5) / n) * 360 - 180;
    const lat0 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180) * M2U; // deg lon → units
    const ky = 110540 * M2U;                                    // deg lat → units
    const toXY = (c) => new THREE.Vector2((c[0] - lon0) * kx, (c[1] - lat0) * ky);

    const pos = [];
    const idx = [];
    let vi = 0;
    const MAXB = CONFIG.BUILDINGS.maxPerTile;
    let count = 0;

    for (const f of gj.features) {
      if (count >= MAXB) break;
      const p = f.properties || {};
      const h = Math.max(3, +p.height || (+p.levels || 0) * 3 || 15) * M2U;
      const h0 = Math.max(0, +p.minHeight || 0) * M2U;
      const geomType = f.geometry?.type;
      const polys =
        geomType === 'Polygon' ? [f.geometry.coordinates]
        : geomType === 'MultiPolygon' ? f.geometry.coordinates
        : [];
      for (const rings of polys) {
        if (!rings?.[0]?.length) continue;
        const contour = rings[0].map(toXY);
        const holes = rings.slice(1).map((r) => r.map(toXY));
        let tris;
        try {
          tris = THREE.ShapeUtils.triangulateShape(contour, holes);
        } catch {
          continue;
        }
        const all = contour.concat(...holes);
        // roof
        const roofBase = vi;
        for (const v of all) pos.push(v.x, h, -v.y); // local: x=east, y=up, z=-north
        for (const t of tris) idx.push(roofBase + t[0], roofBase + t[1], roofBase + t[2]);
        vi += all.length;
        // walls — around each ring
        for (const ring of [contour, ...holes]) {
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            const base = vi;
            pos.push(a.x, h0, -a.y, b.x, h0, -b.y, b.x, h, -b.y, a.x, h, -a.y);
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            vi += 4;
          }
        }
        count++;
      }
    }
    if (!vi) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    BuildingsOverlay._mat ??= new THREE.MeshLambertMaterial({
      color: 0x8fa3b5,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, BuildingsOverlay._mat);
    mesh.frustumCulled = false;
    // Local ENU frame at the anchor: x=east, y=up(surface normal), z=south-ish
    // (matches the -north used above so the basis stays right-handed).
    const anchor = llToV(lat0, lon0, GLOBE_R + 0.0006);
    const up = anchor.clone().normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
    east.normalize();
    const north = up.clone().cross(east);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(east, up, north.negate());
    mesh.matrix.setPosition(anchor);
    return mesh;
  }
}
