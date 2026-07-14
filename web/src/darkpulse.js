import * as THREE from 'three';

// Dark-ship pulse rings (user request §9.1): every DARK contact gets a fixed
// ring at its last known position plus a second ring that swells from the
// centre to the perimeter and repeats — a sonar-style "last known location"
// beacon. Two InstancedMeshes (static + pulse) share one annulus geometry, so
// hundreds of dark ships are two draw calls. Pulse phase is staggered per
// MMSI so the plot doesn't strobe in unison.

const SEGMENTS = 48;
const PERIOD_MS = 2600;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _zUp = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();

export class DarkPulse {
  constructor(scene) {
    // Annulus in the XY plane, unit outer radius; oriented per-instance so its
    // plane is tangent to the globe.
    const ringGeo = new THREE.RingGeometry(0.88, 1, SEGMENTS);
    this.staticMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
    });
    this.pulseMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rings = new THREE.InstancedMesh(ringGeo, this.staticMat, 0);
    this.pulses = new THREE.InstancedMesh(ringGeo, this.pulseMat, 0);
    for (const m of [this.rings, this.pulses]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    this._items = []; // { x, y, z, phase } per dark contact
    this._meta = null; // last meta array ref — rebuild only when the plot changes
  }

  // Called every frame. `L` is the DARK layer record ({ points, meta, visible });
  // `radius` is the current beacon world-size (altitude-scaled by the caller).
  update(L, radius, now = Date.now()) {
    const visible = Boolean(L?.visible && L.meta?.length);
    this.rings.visible = this.pulses.visible = visible;
    if (!visible) return;

    if (L.meta !== this._meta) this._rebuild(L);

    // One matrix pass per frame: static ring at full radius, pulse ring swelling
    // 15%→100% with opacity handled per-mesh (constant — cheap and looks right).
    const items = this._items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      _n.set(it.x, it.y, it.z).normalize();
      _q.setFromUnitVectors(_zUp, _n);
      _m.compose({ x: it.x, y: it.y, z: it.z }, _q, { x: radius, y: radius, z: radius });
      this.rings.setMatrixAt(i, _m);
      const t = ((now + it.phase) % PERIOD_MS) / PERIOD_MS;
      const r = radius * (0.15 + 0.85 * t);
      _m.compose({ x: it.x, y: it.y, z: it.z }, _q, { x: r, y: r, z: r });
      this.pulses.setMatrixAt(i, _m);
    }
    // Fade the pulse as a group toward the rim so the swell reads as dissipating.
    const t = (now % PERIOD_MS) / PERIOD_MS;
    this.pulseMat.opacity = 0.85 * (1 - t * t);
    this.rings.instanceMatrix.needsUpdate = true;
    this.pulses.instanceMatrix.needsUpdate = true;
  }

  _rebuild(L) {
    this._meta = L.meta;
    const pos = L.points.geometry.attributes.position.array;
    this._items = L.meta.map((m, i) => ({
      x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2],
      phase: ((m.mmsi ?? i) * 137) % PERIOD_MS, // stagger, stable per contact
    }));
    const n = this._items.length;
    if (n > (this._cap ?? 0)) {
      // InstancedMesh capacity is fixed at construction — regrow via dispose.
      this._cap = Math.ceil(n * 1.5);
      const parent = this.rings.parent;
      const geo = this.rings.geometry;
      for (const key of ['rings', 'pulses']) {
        const old = this[key];
        parent.remove(old);
        old.dispose();
        this[key] = new THREE.InstancedMesh(geo, old.material, this._cap);
        this[key].frustumCulled = false;
        parent.add(this[key]);
      }
    }
    this.rings.count = this.pulses.count = n;
    const css = L.def?.css || '#ff2e2e';
    this.staticMat.color.set(css);
    this.pulseMat.color.set(css);
  }
}
