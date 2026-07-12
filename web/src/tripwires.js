import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';

// Tracking boxes / tripwires (Theme 1).
//
// The user draws a polygon on the globe; ARGUS counts ENTRIES and EXITS of
// configured contact classes (ships, dark ships, civil aircraft, military
// aircraft) through it, with running tallies — e.g. "how many ships transited
// this gate of the Strait of Hormuz." Detection runs client-side over the
// plotted contacts (so it respects the current filters) on a scan timer.
//
// Crossing is inferred by diffing the set of contact IDs currently inside the
// polygon against the previous scan: newly-inside = entry, newly-outside = exit.
// A box is "primed" on its first scan (populate the inside-set without counting)
// so reloading with saved tallies doesn't count everything already inside as a
// fresh wave of entries.

const CLASSES = [
  { id: 'SEA', label: 'Ships' },
  { id: 'DARK', label: 'Dark' },
  { id: 'AIR', label: 'Civ air' },
  { id: 'MILAIR', label: 'Mil air' },
];
const PALETTE = [0x4fd6e8, 0xffb454, 0xff5d5d, 0x58d68d, 0xb98cf5, 0xe05cff];

// Ray-casting point-in-polygon in lon/lat space. Fine for regional boxes; does
// not handle polygons spanning the antimeridian or a pole (rare for tripwires).
function pointInPoly(lat, lon, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const yi = verts[i][0], xi = verts[i][1];
    const yj = verts[j][0], xj = verts[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class Tripwires {
  constructor(scene, ctx, onChange = () => {}) {
    this.scene = scene;
    this.ctx = ctx;
    this.onChange = onChange; // (re)render the HTML panel
    this.boxes = [];
    this.drawing = null; // { verts:[[lat,lon]], color } while placing a polygon
    this.group = new THREE.Group();
    scene.add(this.group);
    this._load();
  }

  /* ── drawing ─────────────────────────────────────────────────── */
  startDraw() {
    this.drawing = { verts: [], color: PALETTE[this.boxes.length % PALETTE.length] };
    this._render();
    this.onChange();
  }
  addVertex(lat, lon) {
    if (!this.drawing) return;
    this.drawing.verts.push([lat, lon]);
    this._render();
    this.onChange();
  }
  finishDraw(name) {
    if (!this.drawing || this.drawing.verts.length < 3) return false;
    this.boxes.push({
      id: 'tw' + Date.now(),
      name: name || `Tripwire ${this.boxes.length + 1}`,
      verts: this.drawing.verts,
      color: this.drawing.color,
      classes: { SEA: true, DARK: true, AIR: false, MILAIR: true },
      tallies: { in: 0, entries: 0, exits: 0 },
      inside: new Set(),
      primed: false,
    });
    this.drawing = null;
    this._save();
    this._render();
    this.onChange();
    return true;
  }
  cancelDraw() {
    this.drawing = null;
    this._render();
    this.onChange();
  }

  /* ── config / lifecycle ──────────────────────────────────────── */
  toggleClass(boxId, cls) {
    const b = this.boxes.find((x) => x.id === boxId);
    if (!b) return;
    b.classes[cls] = !b.classes[cls];
    b.inside.clear();
    b.primed = false; // re-prime so the class change doesn't spuriously count
    this._save();
    this.onChange();
  }
  rename(boxId, name) {
    const b = this.boxes.find((x) => x.id === boxId);
    if (b) { b.name = name; this._save(); this._render(); this.onChange(); }
  }
  reset(boxId) {
    const b = this.boxes.find((x) => x.id === boxId);
    if (b) { b.tallies = { in: b.tallies.in, entries: 0, exits: 0 }; this._save(); this.onChange(); }
  }
  remove(boxId) {
    this.boxes = this.boxes.filter((x) => x.id !== boxId);
    this._save();
    this._render();
    this.onChange();
  }

  /* ── detection ───────────────────────────────────────────────── */
  // Update tallies from the current plot. Does NOT trigger a full panel render
  // (that would nuke an in-progress name edit); the host refreshes stats itself.
  scan() {
    if (!this.boxes.length) return;
    let crossed = false;
    for (const b of this.boxes) {
      const now = new Set();
      for (const cls of CLASSES) {
        if (!b.classes[cls.id]) continue;
        for (const m of this.ctx.metaFor(cls.id)) {
          if (m.lat == null) continue;
          if (pointInPoly(m.lat, m.lon, b.verts)) now.add(m.icao ?? m.mmsi ?? m.headline);
        }
      }
      if (b.primed) {
        for (const id of now) if (!b.inside.has(id)) { b.tallies.entries++; crossed = true; }
        for (const id of b.inside) if (!now.has(id)) { b.tallies.exits++; crossed = true; }
      }
      b.primed = true;
      b.inside = now;
      b.tallies.in = now.size;
    }
    if (crossed) this._save(); // persist only when a crossing actually happened
  }

  /* ── rendering ───────────────────────────────────────────────── */
  _loop(verts, color, closed) {
    const pts = verts.map((v) => llToV(v[0], v[1], GLOBE_R + 0.05));
    if (closed && pts.length) pts.push(pts[0]);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  }
  _render() {
    for (const c of [...this.group.children]) { c.geometry?.dispose(); this.group.remove(c); }
    for (const b of this.boxes) this.group.add(this._loop(b.verts, b.color, true));
    if (this.drawing && this.drawing.verts.length)
      this.group.add(this._loop(this.drawing.verts, this.drawing.color, this.drawing.verts.length > 2));
  }

  /* ── persistence ─────────────────────────────────────────────── */
  _save() {
    try {
      localStorage.setItem(
        'sentinel.tripwires',
        JSON.stringify(
          this.boxes.map((b) => ({
            id: b.id, name: b.name, verts: b.verts, color: b.color,
            classes: b.classes, tallies: b.tallies,
          })),
        ),
      );
    } catch (_) {}
  }
  _load() {
    try {
      const saved = JSON.parse(localStorage.getItem('sentinel.tripwires') || '[]');
      this.boxes = saved.map((b) => ({ ...b, inside: new Set(), primed: false }));
      this._render();
    } catch (_) {
      this.boxes = [];
    }
  }

  get classList() { return CLASSES; }
}
