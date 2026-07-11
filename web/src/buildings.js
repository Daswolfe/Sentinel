import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';
import { CONFIG } from './config.js';

// 3D buildings at deep zoom — Phase D.
//
// Provider today: OSM Buildings tile API (z15 GeoJSON footprints with height/
// levels attributes, CORS-open). Each tile's buildings are extruded into ONE
// merged prism geometry (walls + roof, triangulated with THREE.ShapeUtils — no
// addons import needed) on the local tangent plane, so a whole tile is a
// single draw call.
//
// UPGRADE PATH (Google Photorealistic 3D Tiles): this class is the seam. It
// exposes update(lat, lon, altUnits) + setEnabled(); a Google provider would
// replace _loadTile/_buildTile with a 3d-tiles-renderer scene rooted the same
// way (local ENU frame at the anchor, metres × M2U). Keep the interface, swap
// the guts — nothing outside this file changes.

const M2U = 1 / 63710; // metres → globe units (1 unit = 63.71 km)
const Z = 15;

export class BuildingsOverlay {
  constructor(scene, onStatus = () => {}) {
    this.scene = scene;
    this.onStatus = onStatus;
    this.enabled = true;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tiles = new Map(); // "x,y" -> { mesh | null(pending/empty), at }
    this.active = false;
    this.gen = 0;
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
  }

  // Called with the camera's ground point once it settles (same cadence as the
  // imagery tile patch). Fetches a GRID×GRID block of z15 tiles when low.
  update(lat, lon, altUnits) {
    if (!this.enabled || altUnits > CONFIG.BUILDINGS.showBelow) {
      this._setActive(false);
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
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
