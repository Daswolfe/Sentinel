import * as THREE from 'three';
import { GLOBE_R } from './globe.js';
import { textSprite } from './labels.js';
import { fmtDist } from './units.js';

// Great-circle measuring tape. Arm it (header button), click two points on
// the globe: an arc is drawn with a mid-arc label — distance in the user's
// units panel setting (+ km alongside when set to nm) and initial bearing.
// A third click starts a fresh measurement; disarming clears. While armed,
// clicks are swallowed before the contact picker sees them.

const ARC_R = GLOBE_R + 0.06; // above imagery/boundaries, below most markers

export class MeasureTool {
  constructor(scene, canvas, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.armed = false;
    this.a = null; // first endpoint (unit Vector3)
    this._onChange = () => {};
    this._down = null;
    // Capture phase + immediate-stop so an armed click never falls through to
    // object picking underneath.
    canvas.addEventListener('pointerdown', (e) => {
      if (this.armed && e.button === 0) this._down = [e.clientX, e.clientY];
    }, true);
    canvas.addEventListener('pointerup', (e) => {
      if (!this.armed || e.button !== 0 || !this._down) return;
      const [dx, dy] = [e.clientX - this._down[0], e.clientY - this._down[1]];
      this._down = null;
      if (dx * dx + dy * dy > 25) return; // that was a drag, not a click
      e.stopImmediatePropagation();
      this._click(e);
    }, true);
  }

  onChange(fn) { this._onChange = fn; }

  setArmed(on) {
    this.armed = on;
    if (!on) this._clear();
    this._onChange(on);
  }

  _clear() {
    this.a = null;
    for (const c of [...this.group.children]) {
      c.geometry?.dispose();
      c.material?.map?.dispose();
      c.material?.dispose();
      this.group.remove(c);
    }
  }

  // Ray → globe sphere; null on a horizon/sky miss.
  _groundPoint(e) {
    const ndc = new THREE.Vector2(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const b = o.dot(d);
    const disc = b * b - (o.lengthSq() - GLOBE_R * GLOBE_R);
    if (disc < 0) return null;
    const s = -b - Math.sqrt(disc);
    if (s < 0) return null;
    return o.clone().addScaledVector(d, s).normalize();
  }

  _click(e) {
    const p = this._groundPoint(e);
    if (!p) return;
    if (this.a) {
      // Second click: complete the measurement (start tick stays as anchor).
      this._draw(this.a, p);
      this.a = null;
      return;
    }
    // First click of a new measurement: drop the previous arc, anchor here.
    this._clear();
    this.a = p;
    const dot = textSprite('✚', 0.7, '#ffd24a', 0.95);
    dot.position.copy(p.clone().multiplyScalar(ARC_R));
    this.group.add(dot);
  }

  _draw(a, b) {
    // Arc: spherical interpolation between the two unit vectors.
    const ang = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    const segs = Math.max(16, Math.ceil(ang * 64));
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const s = Math.sin(ang);
      const p = s < 1e-6
        ? a.clone()
        : a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s)
            .addScaledVector(b, Math.sin(t * ang) / s);
      pts.push(p.normalize().multiplyScalar(ARC_R));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95 }),
    );
    line.frustumCulled = false;

    // Distance + initial bearing.
    const nm = ang * 3440.065; // radians × Earth radius in nm
    const [la1, lo1] = latLon(a), [la2, lo2] = latLon(b);
    const brg = initialBearing(la1, lo1, la2, lo2);
    const km = nm * 1.852;
    const dist = fmtDist(nm);
    const label = textSprite(
      `${dist}${dist.endsWith('nm') ? ` · ${Math.round(km).toLocaleString()} km` : ''} · ${String(Math.round(brg)).padStart(3, '0')}°`,
      1.0, '#ffd24a', 0.95,
    );
    label.position.copy(pts[Math.floor(pts.length / 2)].clone().normalize().multiplyScalar(ARC_R + 1.0));
    const end = textSprite('✚', 0.7, '#ffd24a', 0.95);
    end.position.copy(b.clone().multiplyScalar(ARC_R));
    this.group.add(line, label, end);
  }
}

const latLon = (v) => [
  Math.asin(Math.min(1, Math.max(-1, v.y))) * (180 / Math.PI),
  (Math.atan2(v.z, -v.x) * 180) / Math.PI - 180,
];

function initialBearing(la1, lo1, la2, lo2) {
  const f1 = (la1 * Math.PI) / 180, f2 = (la2 * Math.PI) / 180;
  const dl = (((lo2 - lo1 + 540) % 360) - 180) * (Math.PI / 180);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
