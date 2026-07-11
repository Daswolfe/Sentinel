import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';

// High-resolution ground imagery for deep zoom. A single equirectangular
// texture tops out around 8K (~5 km/px) — nowhere near buildings. This module
// instead drapes a small patch of web-mercator imagery tiles (Esri World
// Imagery: Maxar/Earthstar composites, zoom ≤ 19 ≈ 0.3 m/px) on the sphere
// under the camera, re-fetching as the camera settles over a new spot.
//
// Attribution: Esri, Maxar, Earthstar Geographics — surfaced in the UI via
// the onStatus callback whenever the overlay is active.

const TILE = (z, y, x) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const GRID = 5;         // GRID×GRID tiles per patch
const SHOW_BELOW = 35;  // altitude (globe units, 1 ≈ 63.7 km) to activate
const MIN_Z = 4, MAX_Z = 19;
const SEGS = 24;        // patch grid subdivisions

export class TileOverlay {
  constructor(scene, onStatus = () => {}) {
    this.scene = scene;
    this.onStatus = onStatus; // (active:boolean) — show/hide the credit line
    this.mesh = null;
    this.gen = 0;   // build token — a newer request abandons older fetches
    this.key = '';  // "z/x/y" of the current patch centre (dedup)
    this.active = false;
  }

  hide() {
    if (this.mesh) this.mesh.visible = false;
    if (this.active) {
      this.active = false;
      this.onStatus(false);
    }
    this.key = '';
  }

  // Called with the ground point under the camera once it settles.
  update(lat, lon, altUnits) {
    if (altUnits > SHOW_BELOW) return this.hide();
    const latR = (lat * Math.PI) / 180;
    // Zoom so the GRID-wide patch spans ~2.5× the visible ground width.
    const viewKm = Math.max(altUnits * 63.71, 0.15);
    const z = Math.max(
      MIN_Z,
      Math.min(
        MAX_Z,
        Math.round(
          Math.log2((40075 * Math.max(Math.cos(latR), 0.05) * GRID) / (viewKm * 2.5)),
        ),
      ),
    );
    const n = 2 ** z;
    const cx = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
    const merc = Math.log(Math.tan(latR) + 1 / Math.cos(latR));
    const cy = Math.min(n - 1, Math.max(0, Math.floor(((1 - merc / Math.PI) / 2) * n)));
    const key = `${z}/${cx}/${cy}`;
    if (key === this.key) return;
    this.key = key;
    this._build(z, cx, cy, n);
  }

  async _build(z, cx, cy, n) {
    const gen = ++this.gen;
    const x0 = cx - Math.floor(GRID / 2); // may run past the antimeridian — wrapped at fetch
    const y0 = Math.min(Math.max(cy - Math.floor(GRID / 2), 0), Math.max(n - GRID, 0));
    const imgs = await Promise.all(
      Array.from({ length: GRID * GRID }, (_, i) => {
        const x = ((((x0 + (i % GRID)) % n) + n) % n);
        const y = y0 + Math.floor(i / GRID);
        return this._img(TILE(z, y, x));
      }),
    );
    if (gen !== this.gen) return; // superseded while loading
    let ok = 0;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GRID * 256;
    const g = canvas.getContext('2d');
    imgs.forEach((im, i) => {
      if (!im) return;
      g.drawImage(im, (i % GRID) * 256, Math.floor(i / GRID) * 256);
      ok++;
    });
    if (!ok) return; // offline / blocked — keep whatever is showing
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this._drape(tex, x0, y0, n);
    if (!this.active) {
      this.active = true;
      this.onStatus(true);
    }
  }

  _img(url) {
    return new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
  }

  // Build the curved patch. V maps linearly in tile-Y (i.e. mercator space),
  // so the stitched canvas lines up exactly with the sphere geometry.
  _drape(tex, x0, y0, n) {
    const pos = [], uv = [], idx = [];
    for (let iy = 0; iy <= SEGS; iy++) {
      const v = iy / SEGS;
      const yT = y0 + v * GRID;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * yT) / n))) * 180) / Math.PI;
      for (let ix = 0; ix <= SEGS; ix++) {
        const u = ix / SEGS;
        const lon = ((x0 + u * GRID) / n) * 360 - 180;
        // Hug the surface: must stay BELOW the camera's minimum altitude
        // (0.002 units ≈ 130 m) or deep zoom ends up underneath the imagery.
        const p = llToV(lat, lon, GLOBE_R + 0.0005);
        pos.push(p.x, p.y, p.z);
        uv.push(u, 1 - v);
      }
    }
    for (let iy = 0; iy < SEGS; iy++)
      for (let ix = 0; ix < SEGS; ix++) {
        const a = iy * (SEGS + 1) + ix, b = a + 1, c = a + SEGS + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    this.mesh.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh.geometry = geo;
    const old = this.mesh.material.map;
    this.mesh.material.map = tex;
    this.mesh.material.needsUpdate = true;
    if (old) old.dispose();
    this.mesh.visible = true;
  }
}
