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
    // Never frustum-culled; a fixed conservative sphere keeps three.js from
    // ever running an O(n) computeBoundingSphere over the trail soup.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 800);
    this.obj = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
    );
    this.obj.frustumCulled = false;
    scene.add(this.obj);
  }

  // Grow-only persistent buffers: rebuilding into fresh Float32Arrays every
  // 1.2 s was multi-MB/s of GC churn with 10k+ vessels' trails.
  _ensureCapacity(verts) {
    const geo = this.obj.geometry;
    if (geo.attributes.position.array.length >= verts * 3) return;
    const cap = Math.ceil(verts * 1.5) * 3;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap), 3));
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
    // Pass 1: prune + count segments so the persistent buffers can be sized.
    let segs = 0;
    for (const [id, a] of this.hist) {
      if (aliveIds && !aliveIds.has(id)) {
        this.hist.delete(id);
        continue;
      }
      while (a.length && now - a[0].t > this.maxAgeMs) a.shift();
      if (a.length > 1) segs += a.length - 1;
    }
    this._ensureCapacity(segs * 2);
    // Pass 2: write segment pairs straight into the GPU-bound arrays.
    const g = this.obj.geometry;
    const pos = g.attributes.position.array;
    const col = g.attributes.color.array;
    const c = this.color;
    let o = 0;
    for (const a of this.hist.values()) {
      for (let i = 1; i < a.length; i++) {
        const p0 = a[i - 1], p1 = a[i];
        const f0 = Math.max(0, 1 - (now - p0.t) / this.maxAgeMs);
        const f1 = Math.max(0, 1 - (now - p1.t) / this.maxAgeMs);
        pos[o] = p0.x; pos[o + 1] = p0.y; pos[o + 2] = p0.z;
        col[o] = c.r * f0; col[o + 1] = c.g * f0; col[o + 2] = c.b * f0;
        pos[o + 3] = p1.x; pos[o + 4] = p1.y; pos[o + 5] = p1.z;
        col[o + 3] = c.r * f1; col[o + 4] = c.g * f1; col[o + 5] = c.b * f1;
        o += 6;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, o / 3);
  }

  setVisible(on) {
    this.obj.visible = on;
  }
}

/* ──────────────────────── DIRECTIONAL ARROWS ──────────────────────── */

// A flat filled arrowhead in local space: nose at +Z, lying in the X–Z plane
// (local +Y is the surface normal), so it hugs the globe pointing "forward".
// Kept small — heading markers should read as a tick, not dominate the plot.
export function chevronGeometry() {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0.55,  -0.4, 0, -0.4,  0, 0, -0.18, // left half
    0, 0, 0.55,   0, 0, -0.18,    0.4, 0, -0.4, // right half
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// A flat textured quad in the X–Z plane (nose at +Z), for icon-textured
// directional markers (aircraft/helicopter silhouettes). UVs put the texture's
// TOP row at +Z, so a "nose-up" drawing points along the heading.
export function quadGeometry(s = 0.55) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -s, 0, -s,  s, 0, -s,  s, 0, s,
    -s, 0, -s,  s, 0, s,  -s, 0, s,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,  1, 0,  1, 1,
    0, 0,  1, 1,  0, 1,
  ]), 2));
  g.computeVertexNormals();
  return g;
}

// Top-down white silhouettes (transparent background) pointing UP, so they
// orient to heading once dropped on the quad. Tinted by the layer colour at
// draw time via the material. Cached per kind.
const _dirTexCache = new Map();
export function directionalIconTexture(kind) {
  if (_dirTexCache.has(kind)) return _dirTexCache.get(kind);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  if (kind === 'heli') {
    g.lineCap = 'round';
    g.lineWidth = 2.4; // rotor disc
    g.beginPath();
    g.arc(32, 28, 23, 0, 2 * Math.PI);
    g.stroke();
    g.lineWidth = 3.2; // rotor blades (cross)
    g.beginPath();
    g.moveTo(9, 28); g.lineTo(55, 28);
    g.moveTo(32, 5); g.lineTo(32, 51);
    g.stroke();
    g.fillRect(27, 18, 10, 24); // cabin
    g.fillRect(30, 42, 4, 15);  // tail boom
    g.fillRect(25, 55, 14, 3);  // tail rotor
  } else {
    // fixed-wing jet, nose up
    g.beginPath();
    g.moveTo(32, 4); // nose
    g.lineTo(37, 20);
    g.lineTo(37, 34);
    g.lineTo(60, 46); // right wingtip
    g.lineTo(60, 51);
    g.lineTo(37, 44);
    g.lineTo(37, 52);
    g.lineTo(46, 59); // right tailplane
    g.lineTo(46, 61);
    g.lineTo(32, 56);
    g.lineTo(18, 61); // left tailplane
    g.lineTo(18, 59);
    g.lineTo(27, 52);
    g.lineTo(27, 44);
    g.lineTo(4, 51); // left wingtip
    g.lineTo(4, 46);
    g.lineTo(27, 34);
    g.lineTo(27, 20);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _dirTexCache.set(kind, tex);
  return tex;
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
