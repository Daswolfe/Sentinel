import * as THREE from 'three';
import { GLOBE_R, llToV } from './globe.js';

// Global precipitation-radar overlay from RainViewer. RainViewer's mosaic
// fuses US NOAA NEXRAD with radars worldwide, so this is global weather
// surveillance, animatable through the last ~2 h of frames plus short nowcast.
//
// Rendering: RainViewer serves web-mercator z/x/y PNG tiles per timestamp. We
// assemble a low-zoom global tile grid into one canvas texture and drape it on
// a mercator-conforming sphere shell just above the basemap (depthWrite off, so
// contacts still show through). Assembled frames are cached for smooth looping.

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const Z = 3;            // 2^3 = 8×8 tiles → 2048² canvas: global, weather-scale
const N = 2 ** Z;
const COLOR = 2;        // RainViewer "Universal Blue" scheme
const OPTS = '1_1';     // smoothed + snow
const REFRESH_MS = 5 * 60e3;

function mercLat(v) {
  // v in [0,1] top→bottom → latitude via inverse web-mercator (±85.05°).
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;
}

export class RadarOverlay {
  constructor(scene, onFrame = () => {}) {
    this.scene = scene;
    this.onFrame = onFrame; // (labelText | null) — drives the header timestamp
    this.mesh = null;
    this.frames = [];       // [{ time, path }]
    this.host = '';
    this.texCache = new Map(); // frame.path -> THREE.CanvasTexture
    this.idx = 0;
    this.active = false;
    this.framesAt = 0;
    this._anim = null;
  }

  _buildMesh() {
    const SEGS = 96;
    const pos = [], uv = [], idx = [];
    for (let iy = 0; iy <= SEGS; iy++) {
      const v = iy / SEGS;
      const lat = mercLat(v);
      for (let ix = 0; ix <= SEGS; ix++) {
        const u = ix / SEGS;
        const p = llToV(lat, u * 360 - 180, GLOBE_R + 0.12);
        pos.push(p.x, p.y, p.z);
        uv.push(u, 1 - v);
      }
    }
    for (let iy = 0; iy < SEGS; iy++)
      for (let ix = 0; ix < SEGS; ix++) {
        const a = iy * (SEGS + 1) + ix, b = a + 1, c = a + SEGS + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // over the basemap, under nothing that matters
    this.scene.add(this.mesh);
  }

  async _refreshFrames() {
    if (this.frames.length && Date.now() - this.framesAt < REFRESH_MS) return;
    const j = await (await fetch(FRAMES_URL)).json();
    this.host = j.host;
    this.frames = [...(j.radar?.past || []), ...(j.radar?.nowcast || [])];
    this.framesAt = Date.now();
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

  async _texture(frame) {
    if (this.texCache.has(frame.path)) return this.texCache.get(frame.path);
    const tiles = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        tiles.push({ x, y, p: this._img(`${this.host}${frame.path}/256/${Z}/${x}/${y}/${COLOR}/${OPTS}.png`) });
    const imgs = await Promise.all(tiles.map((t) => t.p));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N * 256;
    const g = canvas.getContext('2d');
    let ok = 0;
    imgs.forEach((im, i) => {
      if (!im) return;
      g.drawImage(im, tiles[i].x * 256, tiles[i].y * 256);
      ok++;
    });
    if (!ok) return null;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(frame.path, tex);
    return tex;
  }

  async _show(i) {
    const frame = this.frames[i];
    if (!frame) return;
    const tex = await this._texture(frame);
    if (!tex || !this.active) return;
    this.mesh.material.map = tex;
    this.mesh.material.needsUpdate = true;
    this.mesh.visible = true;
    const d = new Date(frame.time * 1000);
    const now = this.frames.filter((f) => f.time <= Date.now() / 1000);
    const tag = i >= now.length ? ' (nowcast)' : '';
    this.onFrame(`RADAR ${d.toUTCString().slice(17, 22)}Z${tag}`);
  }

  async toggle() {
    if (this.active) {
      this.active = false;
      clearInterval(this._anim);
      this._anim = null;
      if (this.mesh) this.mesh.visible = false;
      this.onFrame(null);
      return false;
    }
    if (!this.mesh) this._buildMesh();
    this.active = true;
    this.onFrame('RADAR loading…');
    try {
      await this._refreshFrames();
    } catch {
      this.active = false;
      this.onFrame(null);
      return false;
    }
    // Start on the latest observed frame, then animate through the loop.
    this.idx = Math.max(0, this.frames.filter((f) => f.time <= Date.now() / 1000).length - 1);
    await this._show(this.idx);
    this._anim = setInterval(() => {
      if (!this.active || !this.frames.length) return;
      this.idx = (this.idx + 1) % this.frames.length;
      this._show(this.idx);
    }, 900);
    return true;
  }
}
