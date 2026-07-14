import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';

// Nation highlight walls (Theme 3.10).
//
// Click a nation's name label → a translucent extruded wall rises along its
// borders (all outer rings of its Natural Earth MultiPolygon), with a bright
// base line tracing the border itself. Click the name again to clear it.
// Multiple nations can be lit at once, each in its own palette colour.
// Highlights persist across reloads (names only — geometry is rebuilt from
// the border data once it loads).
//
// Geometry: one merged indexed mesh per nation (2 verts per border point,
// bottom→top quad strip) so even Russia is a single draw call, plus one
// LineSegments for the base. Vertex alpha fades the wall from solid at the
// ground to transparent at the top, so it reads as a glow curtain rather
// than a fence.

const PALETTE = [0x4fd6e8, 0xffb454, 0xb98cf5, 0x58d68d, 0xff5d5d, 0xe05cff, 0xf5d76e];
const WALL_H = 1.6;             // scene units ≈ 100 km — visible from globe view
const BASE_R = GLOBE_R + 0.035; // just above the coastline strokes (R+0.03)
const ALPHA_BOTTOM = 0.5;
const ALPHA_TOP = 0.04;

export class NationWalls {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.walls = new Map(); // name → { grp, colorHex }
    this._resolver = null;  // name → rings [[[lat,lon],…],…]
    this._colorIdx = 0;
  }

  // Called once the border GeoJSON is parsed; raises any persisted highlights.
  setResolver(fn) {
    this._resolver = fn;
    for (const name of this._loadSaved()) this._build(name);
  }

  has(name) { return this.walls.has(name); }
  get names() { return [...this.walls.keys()]; }

  // Toggle a nation's wall; returns true if it is now highlighted.
  toggle(name) {
    if (this.walls.has(name)) {
      this._remove(name);
      this._save();
      return false;
    }
    const ok = this._build(name);
    if (ok) this._save();
    return ok;
  }

  clearAll() {
    for (const name of [...this.walls.keys()]) this._remove(name);
    this._save();
  }

  /* ── geometry ────────────────────────────────────────────────── */
  _build(name) {
    const rings = this._resolver?.(name);
    if (!rings?.length) return false;
    const color = new THREE.Color(PALETTE[this._colorIdx++ % PALETTE.length]);

    // Size the merged buffers: each ring is closed by repeating its first
    // point, giving n+1 columns of (bottom, top) vertex pairs.
    let vTotal = 0, iTotal = 0, sTotal = 0;
    for (const r of rings) {
      const cols = r.length + 1;
      vTotal += cols * 2;
      iTotal += (cols - 1) * 6;
      sTotal += (cols - 1) * 2;
    }
    const pos = new Float32Array(vTotal * 3);
    const col = new Float32Array(vTotal * 4); // RGBA — alpha fades with height
    const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
    const seg = new Float32Array(sTotal * 3); // base-line segment pairs

    let v = 0, ii = 0, si = 0;
    for (const r of rings) {
      for (let k = 0; k <= r.length; k++) {
        const [lat, lon] = r[k % r.length];
        const b = llToV(lat, lon, BASE_R);
        const t = llToV(lat, lon, BASE_R + WALL_H);
        pos[v * 3] = b.x; pos[v * 3 + 1] = b.y; pos[v * 3 + 2] = b.z;
        col.set([color.r, color.g, color.b, ALPHA_BOTTOM], v * 4);
        pos[(v + 1) * 3] = t.x; pos[(v + 1) * 3 + 1] = t.y; pos[(v + 1) * 3 + 2] = t.z;
        col.set([color.r, color.g, color.b, ALPHA_TOP], (v + 1) * 4);
        if (k) {
          const a = v - 2; // previous column's bottom vertex
          idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = a + 2;
          idx[ii++] = a + 1; idx[ii++] = a + 3; idx[ii++] = a + 2;
          seg.set(pos.subarray(a * 3, a * 3 + 3), si * 3);
          seg.set(pos.subarray((a + 2) * 3, (a + 2) * 3 + 3), (si + 1) * 3);
          si += 2;
        }
        v += 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
    const base = new THREE.LineSegments(
      baseGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    const grp = new THREE.Group();
    grp.add(mesh, base);
    this.group.add(grp);
    this.walls.set(name, { grp, colorHex: '#' + color.getHexString() });
    return true;
  }

  _remove(name) {
    const w = this.walls.get(name);
    if (!w) return;
    for (const c of w.grp.children) {
      c.geometry.dispose();
      c.material.dispose();
    }
    this.group.remove(w.grp);
    this.walls.delete(name);
  }

  /* ── persistence (names only) ────────────────────────────────── */
  _save() {
    try {
      localStorage.setItem('sentinel.nationWalls', JSON.stringify([...this.walls.keys()]));
    } catch (_) {}
  }
  _loadSaved() {
    try {
      const v = JSON.parse(localStorage.getItem('sentinel.nationWalls') || '[]');
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }
}
