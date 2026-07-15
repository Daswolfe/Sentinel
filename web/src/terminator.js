import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';
import { textSprite } from './labels.js';

// Day/night terminator — a translucent night-side hemisphere shading the
// globe away from the sun, plus a ☀ marker at the subsolar point. Classic
// ops-center context: one glance says who is operating in darkness.
// Solar position is the standard low-precision ephemeris (±0.01°, good for
// decades); refreshed every minute.

// Subsolar point (lat, lon in degrees) for a Date.
export function subsolarPoint(date = new Date()) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5; // days since J2000
  const rad = Math.PI / 180;
  const g = (357.528 + 0.9856003 * d) * rad;            // mean anomaly
  const q = 280.459 + 0.98564736 * d;                   // mean longitude (deg)
  const lam = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic lon
  const e = (23.439 - 0.00000036 * d) * rad;            // obliquity
  const decl = Math.asin(Math.sin(e) * Math.sin(lam));  // declination = subsolar lat
  const ra = Math.atan2(Math.cos(e) * Math.sin(lam), Math.cos(lam)); // right ascension
  const gmst = (280.46061837 + 360.98564736629 * d) % 360; // Greenwich sidereal (deg)
  let lon = (ra / rad - gmst) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: decl / rad, lon };
}

export class Terminator {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // Night shell: a hemisphere cap (pole → equator) re-aimed at the anti-sun
    // point. Sits above the surface overlays but below most markers; alpha is
    // low enough that contacts inside the night side stay readable.
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_R * 1.004, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x020508,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.shell.renderOrder = 1; // after the globe/imagery, before UI sprites
    this.sun = textSprite('☀', 1.6, '#ffd24a', 0.9);
    this.group.add(this.shell, this.sun);
    this._timer = setInterval(() => this._aim(), 60e3);
    this._aim();
    // Persisted toggle (default ON).
    this.setEnabled(localStorage.getItem('sentinel.terminator') !== '0');
  }

  _aim() {
    const { lat, lon } = subsolarPoint();
    const sunDir = llToV(lat, lon, 1).normalize();
    // Cap's +Y pole → anti-sun: the night hemisphere faces away from the sun.
    this.shell.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir.clone().negate());
    this.sun.position.copy(llToV(lat, lon, GLOBE_R + 1.2));
  }

  get enabled() {
    return this.group.visible;
  }

  setEnabled(on) {
    this.group.visible = on;
    try { localStorage.setItem('sentinel.terminator', on ? '1' : '0'); } catch (_) {}
  }

  // Called from the render loop: shading the whole viewport from inside the
  // shell just muddies deep zoom — fade it out below ~95 km altitude.
  updateForAltitude(alt) {
    this.shell.visible = alt > 1.5;
  }
}
