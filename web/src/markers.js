import * as THREE from 'three';

// Shared rendering for "mover" layers (aircraft, ships, satellites):
//   • TrailSet   — a short fading ghost trail behind every contact, always on.
//   • ArrowField — directional chevron markers oriented to heading/COG, laid
//                  flat on the sphere (an alternative to the point sprite).
// Both are driven from the layer's plotted positions, so they respect region
// and contact filters automatically.

/* ───────────────────────────── TRAILS ─────────────────────────────── */

// Per-contact breadcrumb history rendered as one LineSegments with the colour
// fading toward black with age (reads as a fade on the dark globe). Positions
// are pushed each plot; ids not seen this cycle are dropped.
export class TrailSet {
  constructor(scene, colorHex, { maxPoints = 10, maxAgeMs = 4 * 60e3, minDist = 0.004, rebuildMs = 1200 } = {}) {
    this.hist = new Map(); // id -> [{x,y,z,t}]
    this.color = new THREE.Color(colorHex);
    this.maxPoints = maxPoints;
    this.maxAgeMs = maxAgeMs;
    // Ignore sub-threshold jitter (anchored vessels wobble a few metres per
    // report — without this they'd fill their history with useless segments).
    this.minDistSq = minDist * minDist;
    this.rebuildMs = rebuildMs; // geometry rebuild throttle
    this._lastRebuild = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.obj = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
    );
    this.obj.frustumCulled = false;
    scene.add(this.obj);
  }

  setColor(hex) {
    this.color.set(hex);
  }

  push(id, x, y, z) {
    let a = this.hist.get(id);
    if (!a) {
      a = [];
      this.hist.set(id, a);
    }
    const last = a[a.length - 1];
    if (last) {
      const dx = last.x - x, dy = last.y - y, dz = last.z - z;
      if (dx * dx + dy * dy + dz * dz < this.minDistSq) return; // hasn't really moved
    }
    a.push({ x, y, z, t: Date.now() });
    if (a.length > this.maxPoints) a.shift();
  }

  // Rebuild the line geometry, throttled: at 10k+ vessels flushing twice a
  // second, rebuilding every plot allocated multi-MB float arrays per second.
  // `aliveIds` (a Set) prunes contacts gone this cycle.
  rebuild(aliveIds) {
    const now = Date.now();
    // Skipped cycles just defer pruning — the next rebuild's alive-set is
    // always the current truth.
    if (now - this._lastRebuild < this.rebuildMs) return;
    this._lastRebuild = now;
    const pos = [];
    const col = [];
    const c = this.color;
    for (const [id, a] of this.hist) {
      if (aliveIds && !aliveIds.has(id)) {
        this.hist.delete(id);
        continue;
      }
      while (a.length && now - a[0].t > this.maxAgeMs) a.shift();
      for (let i = 1; i < a.length; i++) {
        const f0 = Math.max(0, 1 - (now - a[i - 1].t) / this.maxAgeMs);
        const f1 = Math.max(0, 1 - (now - a[i].t) / this.maxAgeMs);
        pos.push(a[i - 1].x, a[i - 1].y, a[i - 1].z, a[i].x, a[i].y, a[i].z);
        col.push(c.r * f0, c.g * f0, c.b * f0, c.r * f1, c.g * f1, c.b * f1);
      }
    }
    const g = this.obj.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.attributes.position.needsUpdate = true;
    g.computeBoundingSphere();
  }

  setVisible(on) {
    this.obj.visible = on;
  }
}

/* ──────────────────────── DIRECTIONAL ARROWS ──────────────────────── */

// A flat filled arrowhead in local space: nose at +Z, lying in the X–Z plane
// (local +Y is the surface normal), so it hugs the globe pointing "forward".
export function chevronGeometry() {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 1.0,  -0.7, 0, -0.7,  0, 0, -0.3, // left half
    0, 0, 1.0,   0, 0, -0.3,    0.7, 0, -0.7, // right half
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const _Y = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _north = new THREE.Vector3();
const _east = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _x = new THREE.Vector3();
const _s = new THREE.Vector3();

// Fill `out` (Matrix4) with a transform that places a chevron at (x,y,z) on the
// sphere, oriented so its nose points along `headingDeg` (clockwise from north)
// in the local tangent plane, scaled by `size`. Null heading → points north.
export function arrowMatrix(out, x, y, z, headingDeg, size) {
  _p.set(x, y, z);
  _up.copy(_p).normalize();
  // North tangent = world +Y with its along-normal component removed.
  _north.copy(_Y).addScaledVector(_up, -_Y.dot(_up));
  if (_north.lengthSq() < 1e-8) _north.set(0, 0, 1); // at a pole
  _north.normalize();
  _east.crossVectors(_north, _up).normalize();
  const h = ((headingDeg ?? 0) * Math.PI) / 180;
  _fwd.copy(_north).multiplyScalar(Math.cos(h)).addScaledVector(_east, Math.sin(h));
  _x.crossVectors(_up, _fwd).normalize();
  out.makeBasis(_x, _up, _fwd);
  out.setPosition(_p);
  out.scale(_s.set(size, size, size));
  return out;
}
