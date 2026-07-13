import * as THREE from 'three';
import './style.css';
import { CONFIG, REGIONS } from './config.js';
import { GLOBE_R, llToV } from './globe.js';
import { LayerContext, LayerRegistry } from './registry.js';
import { TileOverlay } from './tiles.js';
import { RadarOverlay } from './radar.js';
import { BuildingsOverlay } from './buildings.js';
import { Tripwires } from './tripwires.js';
import { OrbitWatch } from './orbitwatch.js';
import { Dossiers } from './dossiers.js';
import { runwayDiagram } from './runways.js';
import {
  FILTER, contactPasses, NAT_OPTIONS,
  addToWatchlist, removeFromWatchlist, matchesWatchlist, watchlistTerm,
} from './contactFilters.js';
import { textSprite } from './labels.js';

// Layer modules — each is a self-contained data source. Adding a new layer is:
// write a module, import it, drop it in the addAll() list below.
import satellites from './layers/satellites.js';
import aircraft from './layers/aircraft.js';
import milair from './layers/milair.js';
import sea from './layers/sea.js';
import seismic from './layers/seismic.js';
import events from './layers/events.js';
import conflict from './layers/conflict.js';
import launches from './layers/launches.js';
import thermal from './layers/thermal.js';
import jamming from './layers/jamming.js';
import airports from './layers/airports.js';
import cities from './layers/cities.js';
import bikeshare from './layers/bikeshare.js';
import stubLayers from './layers/stubs.js';

/* ═══════════════════════════ GLOBE ════════════════════════════ */
const R = GLOBE_R;
const canvas = document.getElementById('globe');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
let camDist = 320, camTheta = 1.2, camPhi = 1.15;
let camMovedAt = 0; // last camera change — tile overlay waits for it to settle
// Orbit centre: the globe core, or a focused object after double-click.
// Around an object the orbit frame is LOCAL: azimuth spins about the surface
// normal through the object (a "vertical axis" out of the ground), elevation
// is height above its horizon — so dragging left/right pivots smoothly
// around the contact and can never swing the camera under the terrain.
const pivot = new THREE.Vector3(0, 0, 0);
const _camFwd = new THREE.Vector3(); // reused: camera forward for look-at raycast
let orbAz = 0, orbEl = 0.55; // local-frame angles while orbiting a pivot
// Camera modes:
//   'globe'  — orbit the globe centre, look straight down (default map view)
//   'object' — swivel around a double-clicked contact (local ENU frame)
//   'ground' — deep-zoom FREE-LOOK: orbit a ground point so you can tilt to the
//              horizon and see buildings. Entered by right-drag when zoomed in.
let camMode = 'globe';
const FREELOOK_ALT = 6; // altitude (~380 km) below which right-drag frees the camera
const orbiting = () => camMode !== 'globe';

// Local ENU frame at the pivot (east/north/up), up = surface normal.
function pivotFrame() {
  const up = pivot.clone().normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0); // pivot at a pole
  east.normalize();
  const north = up.clone().cross(east);
  return { up, east, north };
}

function placeCamera() {
  if (orbiting()) {
    camDist = Math.max(0.05, Math.min(300, camDist)); // range to the pivot
    orbEl = Math.max(0.04, Math.min(1.56, orbEl));    // stay above its horizon
    const { up, east, north } = pivotFrame();
    const dir = up
      .clone()
      .multiplyScalar(Math.sin(orbEl))
      .addScaledVector(east, Math.cos(orbEl) * Math.sin(orbAz))
      .addScaledVector(north, Math.cos(orbEl) * Math.cos(orbAz));
    camera.position.copy(pivot).addScaledVector(dir, camDist);
    camera.up.copy(up); // keep the local horizon level in-frame
  } else {
    camPhi = Math.max(0.05, Math.min(Math.PI - 0.05, camPhi));
    // Orbiting the globe: clamp ALTITUDE, not distance — min 0.002 units
    // ≈ 130 m, building scale on the tile overlay.
    camDist = R + Math.max(0.002, Math.min(800, camDist - R));
    camera.position.set(
      camDist * Math.sin(camPhi) * Math.cos(camTheta),
      camDist * Math.cos(camPhi),
      camDist * Math.sin(camPhi) * Math.sin(camTheta),
    );
    camera.up.set(0, 1, 0);
  }
  // Near plane follows the true height above ground (or range to the object,
  // whichever is smaller) — the ground would clip away long before deep zoom.
  const altCam = Math.max(0.002, camera.position.length() - R);
  camera.near = Math.max(1e-4, Math.min(altCam, camDist) * 0.05);
  camera.updateProjectionMatrix();
  camera.lookAt(pivot);
  camMovedAt = Date.now();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
placeCamera();

// base sphere + atmosphere
const globeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(R - 0.4, 64, 48),
  new THREE.MeshBasicMaterial({ color: 0x0c1620 }),
);
scene.add(globeMesh);
scene.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x1c4a5f, transparent: true, opacity: 0.1, side: THREE.BackSide }),
  ),
);

// high-res tile imagery patch under the camera (activates on deep zoom)
const tiles = new TileOverlay(scene, (on) => {
  const credit = document.getElementById('tileCredit');
  if (credit) credit.style.display = on ? 'block' : 'none';
});

// 3D buildings at deep zoom (OSM Buildings extrusions — see buildings.js for
// the Google 3D Tiles upgrade seam). Lambert-shaded, so give the scene light
// that Basic-material layers ignore.
scene.add(new THREE.HemisphereLight(0xdde8f0, 0x2a3743, 1.15));
const buildings = new BuildingsOverlay(scene, (on) => {
  document.getElementById('bldgBtn')?.classList.toggle('active', on);
});
document.getElementById('bldgBtn').addEventListener('click', () => {
  buildings.setEnabled(!buildings.enabled);
  document.getElementById('bldgBtn').classList.toggle('on', buildings.enabled);
  ui.tick(buildings.enabled ? '3D buildings ON — extrusions render below ~30 km' : '3D buildings off');
});

// global animated precipitation-radar overlay (RainViewer)
const radar = new RadarOverlay(scene, (label) => {
  const el = document.getElementById('radarTime');
  if (el) el.textContent = label || '';
});
document.getElementById('radarBtn').addEventListener('click', async () => {
  const on = await radar.toggle();
  document.getElementById('radarBtn').classList.toggle('on', on);
  if (on) ui.tick('Weather radar ON — RainViewer global mosaic (NEXRAD + worldwide)');
});

// graticule (hidden on deep zoom — it would scribble over ground imagery)
const gratGrp = (function () {
  const mat = new THREE.LineBasicMaterial({ color: 0x1a2a38, transparent: true, opacity: 0.7 });
  const grp = new THREE.Group();
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let i = 0; i <= 128; i++) pts.push(llToV(lat, (i / 128) * 360 - 180, R + 0.02));
    grp.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * 2 * Math.PI;
      const lat = (Math.asin(Math.sin(a)) * 180) / Math.PI;
      const onFar = Math.cos(a) < 0;
      pts.push(llToV(lat, onFar ? lon + 180 : lon, R + 0.02));
    }
    grp.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  scene.add(grp);
  return grp;
})();

// Country borders + coastlines — Natural Earth 50m at FULL resolution. (The
// old source was decimated every-2nd-vertex and closed rings across the gaps,
// which drew crossing/overlapping strokes.) Also places nation-name labels
// at each country's cartographic label point.
let coastGrp = null;
const nationLbls = new THREE.Group();
const nationPolys = new Map(); // NAME -> [ outerRing[[lat,lon]], … ] (decimated) — for airspace tripwires
scene.add(nationLbls);
fetch(CONFIG.BORDERS.url)
  .then((r) => r.json())
  .then((gj) => {
    const mat = new THREE.LineBasicMaterial({ color: 0x33566e });
    const grp = new THREE.Group();
    for (const f of gj.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys)
        for (const ring of poly) {
          const pts = ring.map((c) => llToV(c[1], c[0], R + 0.03));
          if (pts.length > 2)
            grp.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
      const p = f.properties ?? {};
      const name = p.NAME || p.ADMIN || p.name;
      const lx = p.LABEL_X ?? p.label_x;
      const ly = p.LABEL_Y ?? p.label_y;
      if (name && isFinite(lx) && isFinite(ly)) {
        const sp = textSprite(name.toUpperCase());
        sp.position.copy(llToV(ly, lx, R + 0.4));
        // LABELRANK (1 = major power … 9 = microstate) drives decluttering:
        // zoomed out only the big names show; Europe fills in as you approach.
        sp.userData = { rank: p.LABELRANK ?? p.labelrank ?? 5, base: sp.scale.clone() };
        nationLbls.add(sp);
      }
      // Collect this nation's outer rings (decimated, [lat,lon]) for airspace
      // tripwires — holes/enclaves ignored, which is fine for a crossing count.
      if (name) {
        const rings = [];
        for (const poly of polys) {
          const outer = poly[0];
          if (!outer || outer.length < 4) continue;
          const stride = Math.max(1, Math.ceil(outer.length / 250));
          const r = [];
          for (let i = 0; i < outer.length; i += stride) r.push([outer[i][1], outer[i][0]]);
          if (r.length >= 3) rings.push(r);
        }
        if (rings.length) nationPolys.set(name, rings);
      }
    }
    scene.add(grp);
    coastGrp = grp;
    populateNationPicker();
    ui.info(`Cartography — ${gj.features.length} countries, full-res borders + names`);
  })
  .catch(() => ui.tick('Border basemap unavailable — wireframe mode'));

// Enter deep-zoom free-look: anchor a pivot on the ground point under the
// camera and express the current view in that local frame (no snap), so
// right-drag can then tilt toward the horizon / rotate to inspect buildings.
function enterGroundFreelook() {
  pivot.copy(camera.position).normalize().multiplyScalar(R);
  const off = camera.position.clone().sub(pivot);
  const d = off.length() || 0.01;
  const { up, east, north } = pivotFrame();
  const u = off.clone().divideScalar(d);
  orbEl = Math.asin(Math.max(-1, Math.min(1, u.dot(up))));
  orbAz = Math.atan2(u.dot(east), u.dot(north));
  camDist = d;
  camMode = 'ground';
  camTarget = null;
  ui.tick('Free-look — right-drag tilt/rotate · left-drag pan · scroll zoom');
}
// Hand the view back to the globe frame at the camera's current position.
function exitToGlobe() {
  camMode = 'globe';
  pivot.set(0, 0, 0);
  const p = camera.position;
  camDist = p.length();
  camPhi = Math.acos(p.y / camDist);
  camTheta = Math.atan2(p.z, p.x);
}

// pointer controls (drag rotate / wheel zoom / click pick; right-drag free-look)
let dragging = false, moved = 0, px = 0, py = 0, btn = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  moved = 0;
  px = e.clientX;
  py = e.clientY;
  btn = e.button; // 0 = left, 2 = right
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right-drag look
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - px, dy = e.clientY - py;
  px = e.clientX;
  py = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  const right = btn === 2;
  if (camMode === 'object') {
    if (right) {
      orbAz += dx * 0.006; // right-drag swivels around the focused contact
      orbEl += dy * 0.006;
    } else {
      // Left-drag DESELECTS the contact and hands control back to the globe,
      // applying this drag as the first bit of global rotation.
      exitToGlobe();
      const dragScale = Math.min(1, (camDist - R) / 220);
      camTheta += dx * 0.005 * dragScale;
      camPhi -= dy * 0.005 * dragScale;
      ui.tick('Contact released — globe view');
    }
  } else if (camMode === 'ground') {
    if (right) {
      orbAz += dx * 0.006;  // rotate (yaw) around the ground point
      orbEl -= dy * 0.006;  // drag down → tilt toward the horizon (see buildings)
    } else {
      // Left-drag pans the ground anchor across the surface — in SCREEN-relative
      // directions, so "right" follows the current view yaw (orbAz) instead of
      // always being world-east. Grab-pan: the ground follows the cursor.
      const up = pivot.clone().normalize();
      const { east, north } = pivotFrame();
      const h = east.clone().multiplyScalar(Math.sin(orbAz)).addScaledVector(north, Math.cos(orbAz));
      const rightT = new THREE.Vector3().crossVectors(up, h).normalize(); // screen-right
      const pan = camDist * 0.0016;
      pivot.addScaledVector(rightT, -dx * pan).addScaledVector(h, -dy * pan);
      pivot.normalize().multiplyScalar(R);
    }
  } else {
    // Globe mode: right-drag when zoomed in enough drops into free-look;
    // otherwise left/right drag rotates the globe (pan speed ∝ altitude).
    if (right && camDist - R < FREELOOK_ALT) {
      enterGroundFreelook();
      orbAz += dx * 0.006;
      orbEl += dy * 0.006;
    } else {
      const dragScale = Math.min(1, (camDist - R) / 220);
      camTheta += dx * 0.005 * dragScale;
      camPhi -= dy * 0.005 * dragScale;
    }
  }
  placeCamera();
});
addEventListener('pointerup', (e) => {
  if (dragging && moved < 5 && btn === 0) pick(e); // pick on a left click only
  dragging = false;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    // Exponential in ALTITUDE (or pivot range) — smooth all the way in.
    const f = 1 + Math.sign(e.deltaY) * 0.12;
    if (orbiting()) camDist *= f;
    else camDist = R + (camDist - R) * f;
    // Zooming back out of free-look returns to the top-down globe view.
    if (camMode === 'ground' && camDist > FREELOOK_ALT) exitToGlobe();
    placeCamera();
  },
  { passive: false },
);

// Double-click: focus an object and swivel around it; empty space releases.
canvas.addEventListener('dblclick', (e) => {
  const hit = raycastPoints(e);
  if (hit) {
    pivot.copy(hit.point);
    camMode = 'object';
    camTarget = null; // camTarget glides are globe-frame only
    // Express the (unchanged) camera position in the object's local frame so
    // the focus swap doesn't snap the view, then pull in to a close range.
    const off = camera.position.clone().sub(pivot);
    const d = off.length();
    const { up, east, north } = pivotFrame();
    const u = off.clone().divideScalar(d);
    orbEl = Math.asin(Math.max(-1, Math.min(1, u.dot(up))));
    orbAz = Math.atan2(u.dot(east), u.dot(north));
    camDist = Math.min(d, 1.2);
    ui.tick(`Orbit focus — ${hit.m.headline} · right-drag rotate · left-drag release`);
  } else {
    // Release: hand the view back to the globe frame where the camera sits.
    exitToGlobe();
    camTarget = { theta: camTheta, phi: camPhi, dist: Math.max(camDist, 180) };
    ui.tick('Orbit focus released — globe view');
  }
  placeCamera();
});

/* ═══════════════ CONTEXT + LAYER REGISTRY ═════════════════════ */
let activeRegion = null;
let scrubT = null; // null = live, else epoch ms

const ctx = new LayerContext({
  scene,
  ui: null, // set after ui is defined
  alerts: null, // set after Alerts is defined
  getRegion: () => activeRegion,
  getScrubT: () => scrubT,
});

const registry = new LayerRegistry(ctx);
registry.addAll([
  satellites,
  aircraft,
  milair,
  sea,
  seismic,
  events,
  conflict,
  thermal,
  launches,
  jamming,
  airports,
  cities,
  bikeshare,
  ...stubLayers,
]);

/* ═══════════════════════════ UI ═══════════════════════════════ */
const ui = {
  init() {
    const list = document.getElementById('layerlist');
    const st = document.getElementById('statuses');
    const savedColors = JSON.parse(localStorage.getItem('sentinel.layerColors') || '{}');
    const savedIcons = JSON.parse(localStorage.getItem('sentinel.layerIcons') || '{}');
    const savedSizes = JSON.parse(localStorage.getItem('sentinel.layerSizes') || '{}');
    const save = (k, o) => localStorage.setItem('sentinel.' + k, JSON.stringify(o));
    // ➤ chevron · ✈ plane · 🚁 heli are heading-ORIENTED (rotate to travel dir);
    // ╳ is the airport crossed-runways symbol; the rest are static sprites.
    const ICONS = ['●', '➤', '✈', '🚁', '╳', '▲', '▼', '■', '◆', '✚', '⚓', '⚠'];
    const defaultIcons = { AIR: '✈', MILAIR: '✈', SEA: '➤', DARK: '⚠', APT: '╳' };
    // One-time migration: mover/airport defaults changed to oriented silhouettes
    // (✈) and the runway symbol (╳). Drop the superseded saved glyphs once so the
    // new defaults apply; users can still re-pick per layer afterwards.
    if (+(localStorage.getItem('sentinel.prefsV') || 0) < 3) {
      for (const id of ['AIR', 'MILAIR', 'SEA', 'DARK', 'APT']) delete savedIcons[id];
      save('layerIcons', savedIcons);
      localStorage.setItem('sentinel.prefsV', '3');
    }
    for (const d of registry.defsList()) {
      for (const def of [d, ...(d.companions ?? [])]) {
        const color = savedColors[def.id] || def.css;
        const icon = savedIcons[def.id] || defaultIcons[def.id] || '●';
        const size = savedSizes[def.id] ?? 1;
        // Apply persisted style before the first plot. iconScale must be set
        // before setLayerIcon so the point size picks it up.
        def.iconScale = size;
        if (savedColors[def.id]) ctx.setLayerColor(def.id, color);
        ctx.setLayerIcon(def.id, icon);

        const row = document.createElement('div');
        row.className = 'layer' + (def.disabled ? ' disabled' : '');
        row.innerHTML = `<input type="checkbox" ${def.disabled || def.defaultOff ? '' : 'checked'} ${def.disabled ? 'disabled' : ''}>
          <details class="stylemenu">
            <summary title="Style: colour, icon, size"><span class="chip" style="color:${color}">${icon}</span></summary>
            <div class="stylepop">
              <div class="sp-row"><span>COLOUR</span><input type="color" class="c-color" value="${color}"></div>
              <div class="sp-row"><span>ICON</span><div class="c-icons">${ICONS.map(
                (i) => `<button type="button" class="ic${i === icon ? ' on' : ''}" data-i="${i}">${i}</button>`,
              ).join('')}</div></div>
              <div class="sp-row"><span>SIZE</span><input type="range" class="c-size" min="0.2" max="3" step="0.1" value="${size}"><b class="c-sizeval">${(+size).toFixed(1)}×</b></div>
            </div>
          </details>
          <span class="name">${def.name}</span>
          ${def.tag ? `<span class="tag ${def.tag === 'STUB' ? 'stub' : ''}">${def.tag}</span>` : ''}
          <span class="mode wait" id="mode-${def.id}">…</span>
          <span class="count" id="cnt-${def.id}">—</span>`;

        const chip = row.querySelector('.chip');
        row.querySelector('input[type=checkbox]').addEventListener('change', (ev) => {
          ctx.setVisible(def.id, ev.target.checked);
          d.onVisible?.(ev.target.checked); // e.g. aircraft trails follow AIR
        });
        // Clicking the name toggles the layer (the row is no longer a <label>).
        row.querySelector('.name').addEventListener('click', () => {
          if (def.disabled) return;
          const cb = row.querySelector('input[type=checkbox]');
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        });
        row.querySelector('.c-color').addEventListener('input', (ev) => {
          ctx.setLayerColor(def.id, ev.target.value);
          chip.style.color = ev.target.value;
          savedColors[def.id] = ev.target.value;
          save('layerColors', savedColors);
        });
        row.querySelector('.c-icons').addEventListener('click', (ev) => {
          const btn = ev.target.closest('.ic');
          if (!btn) return;
          const g = btn.dataset.i;
          ctx.setLayerIcon(def.id, g);
          chip.textContent = g;
          row.querySelectorAll('.ic').forEach((b) => b.classList.toggle('on', b === btn));
          savedIcons[def.id] = g;
          save('layerIcons', savedIcons);
        });
        row.querySelector('.c-size').addEventListener('input', (ev) => {
          const v = +ev.target.value;
          ctx.setLayerSize(def.id, v);
          row.querySelector('.c-sizeval').textContent = v.toFixed(1) + '×';
          savedSizes[def.id] = v;
          save('layerSizes', savedSizes);
        });

        list.appendChild(row);
        st.insertAdjacentHTML(
          'beforeend',
          `<span class="st"><span class="dot wait" id="st-${def.id}"></span>${def.id}</span>`,
        );
      }
    }
    // Only one style menu open at a time; close on outside click.
    list.addEventListener('toggle', (e) => {
      if (e.target.tagName === 'DETAILS' && e.target.open)
        list.querySelectorAll('details.stylemenu[open]').forEach((d) => { if (d !== e.target) d.open = false; });
    }, true);
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.stylemenu'))
        list.querySelectorAll('details.stylemenu[open]').forEach((d) => (d.open = false));
    });
    // Alert rows: ✓ acknowledges, ✕ deletes, clicking the body locates.
    document.getElementById('alertList').addEventListener('click', (e) => {
      const row = e.target.closest('.alert');
      if (!row || row.dataset.i == null) return;
      const i = +row.dataset.i;
      if (e.target.classList.contains('aAck')) return Alerts.ack(i);
      if (e.target.classList.contains('aDel')) return Alerts.remove(i);
      const a = Alerts.log[i];
      if (a?.lat != null) {
        // Prefer the contact's LIVE position over the alert's birthplace.
        const live = liveContactPos(a.ref);
        const lat = live?.lat ?? a.lat, lon = live?.lon ?? a.lon;
        flyTo(lat, lon, R + 0.25); // dive to max zoom
        this.tick(
          `Camera on alert — ${a.title} @ ${lat.toFixed(2)}°, ${lon.toFixed(2)}°${live ? ' (live)' : ''}`,
        );
      }
    });
    document.getElementById('ackAll').addEventListener('click', () => Alerts.ackAll());
    this.renderAlerts();
  },
  count(id, n) {
    const el = document.getElementById('cnt-' + id);
    if (el) el.textContent = n;
  },
  // Layer data-source states — shown as the header dot AND a sidebar badge:
  //   ok   → LIVE  real data flowing        sim  → SIM   synthetic/demo data
  //   off  → OFF   not wired / key missing  err  → ERR   fetch failed
  //   wait → …     loading
  modeLabels: { ok: 'LIVE', sim: 'SIM', err: 'ERR', off: 'OFF', wait: '…' },
  status(id, cls) {
    const el = document.getElementById('st-' + id);
    if (el) el.className = 'dot ' + cls;
    const badge = document.getElementById('mode-' + id);
    if (badge) {
      badge.textContent = this.modeLabels[cls] ?? cls.toUpperCase();
      badge.className = 'mode ' + cls;
      badge.title = {
        ok: 'Live — real data from the source',
        sim: 'Simulated — synthetic data, not real-world',
        err: 'Error — source unreachable or failed',
        off: 'Off — no key / not wired to a source',
        wait: 'Loading…',
      }[cls] ?? '';
    }
  },
  renderAlerts() {
    const box = document.getElementById('alertList');
    if (!box) return;
    const log = typeof Alerts !== 'undefined' ? Alerts.log : [];
    document.getElementById('alertCount').textContent = log.filter((a) => !a.acked).length;
    box.innerHTML =
      log
        .slice(0, 20)
        .map(
          (a, i) =>
            `<div class="alert${a.lat != null ? ' go' : ''}${a.acked ? ' acked' : ''}" data-i="${i}">
              <span class="aBtns"><span class="aAck" title="Acknowledge">✓</span><span class="aDel" title="Delete">✕</span></span>
              <b>${a.title}</b>${a.msg}<span>${new Date(a.t).toUTCString().slice(17, 25)}Z${a.lat != null ? ' · ⌖ CLICK TO LOCATE' : ''}</span></div>`,
        )
        .join('') || `<div class="alert" style="color:var(--dim)">No alerts. Watch conditions nominal.</div>`;
  },
  showDetail(m) {
    document.getElementById('detail').style.display = 'block';
    const rows = Object.entries(m.rows)
      .map(([k, v]) => `<div class="kv"><b>${k}</b><span>${v ?? '—'}</span></div>`)
      .join('');
    // Add-to-watchlist for moving contacts.
    const CONTACT = ['AIR', 'MILAIR', 'SEA', 'DARK'].includes(m.layer);
    const term = CONTACT ? watchlistTerm(m) : '';
    const watching = term && FILTER.watchlist.some((w) => w.toUpperCase() === term.toUpperCase());
    document.getElementById('detailBody').innerHTML =
      `<div class="headline">${m.headline}</div>${rows}${m.html || ''}
       ${String(m.rows.SOURCE || '').includes('Simulation') ? `<div class="note">⚠ Simulated track for layout/testing — not real vessel data.</div>` : ''}
       ${CONTACT ? `<button id="watchBtn" class="${watching ? 'on' : ''}">${watching ? '★ WATCHING — remove' : '☆ ADD TO WATCHLIST'}</button>` : ''}
       ${(m.layer === 'AIR' || m.layer === 'MILAIR') && m.icao ? `<div class="note" id="dossier">↳ Pulling dossier from adsbdb…</div>` : ''}
       ${m.layer === 'APT' && m.icao ? `<div class="note" id="metar">↳ Pulling METAR/TAF from aviationweather.gov…</div>` : ''}`;
    if (CONTACT) {
      document.getElementById('watchBtn').onclick = () => {
        if (watching) removeFromWatchlist(term);
        else { addToWatchlist(term); this.tick(`Watchlist — added “${term}”`); }
        renderWatchlist();
        ctx.refilterAll();
        this.showDetail(m); // re-render the button's state
      };
    }
    if ((m.layer === 'AIR' || m.layer === 'MILAIR') && m.icao) renderDossier(m.icao, m.callsign);
  },
  closeDetail() {
    document.getElementById('detail').style.display = 'none';
    clearFocusPath();
  },
  tickItems: ['ARGUS online — all feeds initializing'],
  // Routine telemetry (per-refresh counts, catalog loads). Deliberately NOT
  // in the LIVE FEED ticker — that's for significant events. Console only.
  info(msg) {
    console.debug('[sentinel]', msg);
  },
  tick(msg) {
    this.tickItems.push(msg);
    if (this.tickItems.length > 12) this.tickItems.shift();
    document.getElementById('ticker').innerHTML = this.tickItems
      .map((t) => `<b>${t}</b>`)
      .join(`<span class="sep">◆</span>`);
  },
};
window.ui = ui; // for the detail-panel close button wired in index.html
ctx.ui = ui;

/* ═══════════════ TRACKING BOXES / TRIPWIRES ═══════════════════ */
const tripwires = new Tripwires(scene, ctx, () => renderTripwiresPanel());
const twStatsHtml = (b) =>
  `IN <b>${b.tallies.in}</b> · IN-TOTAL <b>${b.tallies.entries}</b> · OUT <b>${b.tallies.exits}</b>`;
function renderTripwiresPanel() {
  const drawing = !!tripwires.drawing;
  document.getElementById('twDraw').style.display = drawing ? 'none' : '';
  const bar = document.getElementById('twDrawBar');
  bar.style.display = drawing ? '' : 'none';
  if (drawing)
    bar.firstChild.textContent = `Placed ${tripwires.drawing.verts.length} point(s) — keep clicking, then `;
  const list = document.getElementById('twList');
  if (!tripwires.boxes.length) {
    list.innerHTML =
      '<div class="twEmpty">No tripwires. Draw a box to count contacts entering/exiting it.</div>';
    return;
  }
  list.innerHTML = tripwires.boxes
    .map((b) => {
      const sw = '#' + b.color.toString(16).padStart(6, '0');
      const cls = tripwires.classList
        .map(
          (c) =>
            `<label class="twc"><input type="checkbox" data-tw="${b.id}" data-cls="${c.id}" ${b.classes[c.id] ? 'checked' : ''}>${c.label}</label>`,
        )
        .join('');
      return `<div class="twItem" style="border-left-color:${sw}">
        <div class="twHead"><input class="twName" data-tw="${b.id}" value="${b.name.replace(/"/g, '&quot;')}">
          <span class="twReset" data-tw="${b.id}" title="Reset counts">↺</span>
          <span class="twDel" data-tw="${b.id}" title="Delete tripwire">✕</span></div>
        <div class="twStats" id="twStats-${b.id}">${twStatsHtml(b)}</div>
        <div class="twCls">${cls}</div></div>`;
    })
    .join('');
}
function updateTripwireStats() {
  for (const b of tripwires.boxes) {
    const el = document.getElementById('twStats-' + b.id);
    if (el) el.innerHTML = twStatsHtml(b);
  }
}
document.getElementById('twDraw').addEventListener('click', () => {
  tripwires.startDraw();
  ui.tick('Tripwire draw — click the globe to place points, then ✓ FINISH (Esc cancels)');
});
document.getElementById('twFinish').addEventListener('click', () => {
  if (!tripwires.finishDraw()) ui.tick('Need at least 3 points to close a tripwire');
});
document.getElementById('twCancel').addEventListener('click', () => tripwires.cancelDraw());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tripwires.drawing) tripwires.cancelDraw();
});
// Airspace tripwires: pick a nation → build a tripwire from its border polygons.
function populateNationPicker() {
  const sel = document.getElementById('twNation');
  if (!sel) return;
  const names = [...nationPolys.keys()].sort((a, b) => a.localeCompare(b));
  sel.insertAdjacentHTML(
    'beforeend',
    names.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join(''),
  );
}
document.getElementById('twNation').addEventListener('change', (e) => {
  const name = e.target.value;
  e.target.value = '';
  if (!name) return;
  const rings = nationPolys.get(name);
  if (!rings) return;
  if (tripwires.addAirspace(name, rings)) ui.tick(`Airspace tripwire — ${name} (air in/out)`);
  else ui.tick(`${name} airspace tripwire already exists`);
});
const twList = document.getElementById('twList');
twList.addEventListener('click', (e) => {
  const id = e.target.dataset?.tw;
  if (!id) return;
  if (e.target.classList.contains('twDel')) tripwires.remove(id);
  else if (e.target.classList.contains('twReset')) tripwires.reset(id);
});
twList.addEventListener('change', (e) => {
  const { tw, cls } = e.target.dataset || {};
  if (tw && cls) tripwires.toggleClass(tw, cls);
});
twList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('twName')) e.target.blur();
});
twList.addEventListener(
  'blur',
  (e) => {
    if (e.target.classList?.contains('twName'))
      tripwires.rename(e.target.dataset.tw, e.target.value.trim() || 'Tripwire');
  },
  true,
);
setInterval(() => {
  tripwires.scan();
  updateTripwireStats();
}, 2500);
renderTripwiresPanel();

/* ═══════════════ SURVEILLANCE-ORBIT DETECTOR ══════════════════ */
const orbitWatch = new OrbitWatch(scene, ctx, (m, o) => {
  if (!m) return;
  Alerts.fire(
    'SURVEILLANCE ORBIT',
    `${m.headline} circling — ${o.loops.toFixed(1)} loops, ~${o.radiusKm.toFixed(0)} km radius`,
    o.lat,
    o.lon,
    { icao: m.icao },
  );
});
setInterval(() => orbitWatch.scan(), 15000);

/* ═══════════════════════ DOSSIERS ═════════════════════════════ */
let dosBriefBusy = false; // suppress re-render while a brief streams
const dosBriefCache = new Map(); // code -> last brief text (session only)
const dossiers = new Dossiers(() => {
  if (!dosBriefBusy) renderDossierPanel();
});
function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
let dosOpen = null;
function renderDossierPanel() {
  const list = document.getElementById('dosList');
  if (!list) return;
  const ds = dossiers.list();
  if (!ds.length) {
    list.innerHTML =
      '<div class="dosEmpty">No dossiers yet. They build automatically as attributable alerts ' +
      '(dark ships, military squawks, STS transfers, surveillance orbits…) accrue by flag state.</div>';
    return;
  }
  list.innerHTML = ds
    .map((d) => {
      const open = d.code === dosOpen;
      let body = '';
      if (open) {
        const evs = d.events
          .slice(0, 25)
          .map(
            (e) =>
              `<div class="dosEv"><b>${e.type}</b> ${e.summary}<span>${new Date(e.t).toUTCString().slice(5, 22)}</span></div>`,
          )
          .join('');
        body =
          `<div class="dosEvents">${evs}</div>` +
          `<div class="dosBar"><span class="dosBrief" data-code="${d.code}">◈ LLM BRIEF</span>` +
          `<span class="dosClear" data-code="${d.code}">✕ clear</span></div>` +
          `<div class="dosBriefOut" id="dosBrief-${d.code}" style="display:none"></div>`;
      }
      return `<div class="dosItem${open ? ' open' : ''}">
        <div class="dosHead" data-code="${d.code}"><b>${d.name}</b>
          <span class="dosCount">${d.events.length} · ${timeAgo(d.lastSeen)}</span></div>${body}</div>`;
    })
    .join('');
  // Restore a cached brief for the open dossier (survives re-renders).
  if (dosOpen && dosBriefCache.has(dosOpen)) {
    const el = document.getElementById('dosBrief-' + dosOpen);
    if (el) { el.style.display = 'block'; el.textContent = dosBriefCache.get(dosOpen); }
  }
}
document.getElementById('dosList').addEventListener('click', (e) => {
  const code = e.target.closest('[data-code]')?.dataset.code;
  if (!code) return;
  if (e.target.classList.contains('dosBrief')) {
    const out = document.getElementById('dosBrief-' + code);
    out.style.display = 'block';
    dosBriefBusy = true;
    streamLLM(dossiers.briefPrompt(code), out)
      .then((text) => dosBriefCache.set(code, text || out.textContent))
      .finally(() => { dosBriefBusy = false; });
  } else if (e.target.classList.contains('dosClear')) {
    dosBriefCache.delete(code);
    dossiers.clear(code);
  } else {
    dosOpen = dosOpen === code ? null : code;
    renderDossierPanel();
  }
});
renderDossierPanel();

/* ═══════════════════════ WATCHLIST v2 ═════════════════════════ */
function renderWatchlist() {
  const list = document.getElementById('wlList');
  if (!FILTER.watchlist.length) {
    list.innerHTML = '<div class="wlEmpty">Empty. Add a term, or ☆ a contact from its detail panel.</div>';
    return;
  }
  list.innerHTML = FILTER.watchlist
    .map(
      (w) =>
        `<span class="wlChip">${w}<span class="wlX" data-w="${w.replace(/"/g, '&quot;')}" title="Remove">✕</span></span>`,
    )
    .join('');
}
document.getElementById('wlAddBtn').addEventListener('click', () => {
  const inp = document.getElementById('wlInput');
  if (addToWatchlist(inp.value)) {
    inp.value = '';
    renderWatchlist();
    ctx.refilterAll();
  }
});
document.getElementById('wlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('wlAddBtn').click();
});
document.getElementById('wlList').addEventListener('click', (e) => {
  const w = e.target.dataset?.w;
  if (w) { removeFromWatchlist(w); renderWatchlist(); ctx.refilterAll(); }
});
renderWatchlist();

// Alert-on-appear: fire once when a watched contact newly enters the plot.
// Primed silently on first scan so everything already present at startup
// doesn't trigger a wave of alerts; Alerts.fire dedups per unique contact.
let watchSeen = new Set();
let watchPrimed = false;
function scanWatchlist() {
  if (!document.getElementById('wlAlertOn').checked) { watchPrimed = false; return; }
  const now = new Set();
  const first = new Map();
  for (const id of ['AIR', 'MILAIR', 'SEA', 'DARK'])
    for (const m of ctx.metaFor(id)) {
      if (m.lat == null || !matchesWatchlist(m)) continue;
      const key = m.icao ?? m.mmsi ?? m.headline;
      now.add(key);
      if (!first.has(key)) first.set(key, m);
    }
  if (watchPrimed)
    for (const key of now)
      if (!watchSeen.has(key)) {
        const m = first.get(key);
        Alerts.fire('WATCHLIST', `${m.headline} entered the plot`, m.lat, m.lon, {
          icao: m.icao, mmsi: m.mmsi,
        });
      }
  watchPrimed = true;
  watchSeen = now;
}
setInterval(scanWatchlist, 5000);

// adsbdb dossier rendering (uses the aircraft module's fetch helper)
async function renderDossier(icao, callsign) {
  try {
    const resp = await aircraft.dossier(icao, callsign);
    const el = document.getElementById('dossier');
    if (!el) return;
    const ac = resp?.aircraft, fr = resp?.flightroute;
    if (!ac && !fr) {
      el.textContent = 'No dossier match in adsbdb.';
      return;
    }
    let html = '';
    if (ac)
      html +=
        `<div class="kv"><b>AIRCRAFT</b><span>${ac.manufacturer || ''} ${ac.type || ac.icao_type || ''}</span></div>` +
        `<div class="kv"><b>REG</b><span>${ac.registration || '—'}</span></div>` +
        `<div class="kv"><b>OWNER</b><span>${ac.registered_owner || '—'}</span></div>` +
        `<div class="kv"><b>FLAG</b><span>${ac.registered_owner_country_name || '—'}</span></div>`;
    if (fr?.origin)
      html += `<div class="kv"><b>ROUTE</b><span>${fr.origin.iata_code || '?'} → ${fr.destination?.iata_code || '?'}</span></div>`;
    if (ac?.url_photo_thumbnail)
      html += `<img src="${ac.url_photo_thumbnail}" style="width:100%;margin-top:7px;border-radius:3px">`;
    el.innerHTML = `<div style="color:var(--amber);margin-bottom:4px">DOSSIER — adsbdb</div>${html}`;
  } catch (e) {
    const el = document.getElementById('dossier');
    if (el) el.textContent = 'Dossier lookup failed.';
  }
}

// mission clock
setInterval(() => {
  const n = new Date();
  document.getElementById('clock').firstChild.textContent = n.toUTCString().slice(17, 25);
}, 500);

// backend feed-health strip (tracked vessels, dark flags vs suppressions,
// STS candidates, OpenSky auth) — lets the operator tune thresholds at a glance
async function pollHealth() {
  const el = document.getElementById('healthStrip');
  try {
    const h = await (await fetch('/api/health')).json();
    const s = h.ais?.stats ?? {};
    el.textContent =
      `AIS ${(h.ais?.tracked ?? 0).toLocaleString()} · ` +
      `DARK ${s.darkFlagged ?? 0}⚑ ${s.darkSuppressed ?? 0}⌀ · ` +
      `STS ${h.analytics?.stsAlerts ?? 0} · LTR ${h.analytics?.loiterAlerts ?? 0} · ` +
      `SKY ${h.opensky?.authed ? '✓' : '✗'}${h.db ? ' · DB ✓' : ''}`;
    el.classList.remove('down');
  } catch {
    el.textContent = 'BACKEND DOWN';
    el.classList.add('down');
  }
}
pollHealth();
setInterval(pollHealth, 30e3);

/* ═════════════════════════ PICKING ════════════════════════════ */
const ray = new THREE.Raycaster();
ray.params.Points = { threshold: 1.8 };
const mouse = new THREE.Vector2();

// Raycast the layer markers (point clouds, or arrow InstancedMeshes for layers
// in arrow mode); returns { m, point } or null.
function raycastPoints(e) {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(mouse, camera);
  ray.params.Points.threshold = Math.max(0.001, (camera.position.length() - R) / 120);
  const targets = ctx.pickTargets();
  const hits = ray.intersectObjects(targets.map((t) => t.obj));
  if (!hits.length) return null;
  const h = hits[0];
  const t = targets.find((t) => t.obj === h.object);
  if (!t) return null;
  const idx = h.instanceId != null ? h.instanceId : h.index; // arrow vs point
  const m = t.L.meta[idx];
  return m ? { m, point: h.point } : null;
}

function pick(e) {
  // While drawing a tripwire, a globe click drops a polygon vertex (no contact
  // pick / weather query).
  if (tripwires.drawing) {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const sh = ray.intersectObject(globeMesh);
    if (sh.length) {
      const p = sh[0].point.clone().normalize();
      const lat = 90 - (Math.acos(p.y) * 180) / Math.PI;
      let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
      if (lon < -180) lon += 360;
      tripwires.addVertex(lat, lon);
    }
    return;
  }
  const hit = raycastPoints(e);
  if (hit) return onPick(hit.m);
  const sphereHit = ray.intersectObject(globeMesh); // ray still set from raycastPoints
  if (sphereHit.length) {
    const p = sphereHit[0].point.clone().normalize();
    const lat = 90 - (Math.acos(p.y) * 180) / Math.PI;
    let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
    if (lon < -180) lon += 360;
    ui.showDetail({
      layer: 'WX',
      headline: 'SURFACE POINT',
      rows: { LAT: lat.toFixed(3) + '°', LON: lon.toFixed(3) + '°', WEATHER: 'querying…' },
    });
    weatherAt(lat, lon)
      .then((w) => {
        if (!w) return;
        ui.showDetail({
          layer: 'WX',
          headline: 'SURFACE POINT — WX',
          rows: {
            LAT: lat.toFixed(3) + '°',
            LON: lon.toFixed(3) + '°',
            TEMP: w.temperature_2m + ' °C',
            WIND: w.wind_speed_10m + ' km/h @ ' + w.wind_direction_10m + '°',
            CLOUD: w.cloud_cover + ' %',
            PRECIP: w.precipitation + ' mm',
            SOURCE: 'Open-Meteo',
          },
          html: windRose(w.wind_direction_10m, `${w.wind_speed_10m} km/h`) + wmoDesc(w.weather_code),
        });
      })
      .catch(() => {});
  }
}
async function weatherAt(lat, lon) {
  const u = `${CONFIG.WEATHER.url}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code`;
  const j = await (await fetch(u)).json();
  return j.current;
}

// One pick handler for every layer: detail panel + per-type extras.
function onPick(m) {
  ui.showDetail(m);
  clearFocusPath();
  if ((m.layer === 'AIR' || m.layer === 'MILAIR') && m.icao) loadAircraftPath(m);
  else if ((m.layer === 'SEA' || m.layer === 'DARK') && m.mmsi) loadVesselPath(m);
  else if (m.layer === 'APT' && m.icao) renderMetar(m);
}

/* ═══════════ FOCUSED CONTACT: PATH + FLIGHT PROFILE ═══════════ */
const pathGrp = new THREE.Group();
scene.add(pathGrp);
const pathMats = {
  AIR: new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.9 }),
  SEA: new THREE.LineBasicMaterial({ color: 0x58d68d, transparent: true, opacity: 0.9 }),
};

function clearFocusPath() {
  for (const c of [...pathGrp.children]) {
    c.geometry.dispose();
    pathGrp.remove(c);
  }
  document.getElementById('profile').style.display = 'none';
}

function drawPath(pts, mat) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  line.frustumCulled = false;
  pathGrp.add(line);
}

function havKm(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Full path since takeoff (OpenSky tracks API via the backend).
async function loadAircraftPath(m) {
  try {
    const j = await (await fetch(`/api/opensky/track?icao24=${m.icao}`)).json();
    const path = j.path || [];
    if (path.length < 2) return ui.tick(`No stored track for ${m.headline} (OpenSky)`);
    drawPath(
      path.map((p) => llToV(p[1], p[2], R * (1 + Math.max(p[3] ?? 0, 0) / 1000 / 6371) + 0.02)),
      pathMats.AIR,
    );
    renderProfile(m, path);
  } catch (_) {
    ui.tick('Flight track fetch failed (OpenSky tracks API)');
  }
}

// Breadcrumb history from the AIS relay (builds while the backend runs).
async function loadVesselPath(m) {
  try {
    const j = await (await fetch(`/api/ais/track?mmsi=${m.mmsi}`)).json();
    const tr = j.track || [];
    if (tr.length < 2)
      return ui.tick(`No stored track yet for ${m.headline} — history accrues while the relay runs`);
    drawPath(tr.map((p) => llToV(p[1], p[2], R + 0.05)), pathMats.SEA);
    const hrs = (tr[tr.length - 1][0] - tr[0][0]) / 36e5;
    ui.tick(`Track — ${m.headline}: ${tr.length} fixes over ${hrs.toFixed(1)} h`);
  } catch (_) {
    ui.tick('Vessel track fetch failed (AIS relay)');
  }
}

// Altitude + ground-speed graph for the focused flight.
function renderProfile(m, path) {
  const alts = path.map((p) => Math.max(p[3] ?? 0, 0) * 3.281); // m → ft
  const spds = [0];
  for (let i = 1; i < path.length; i++) {
    const km = havKm(path[i - 1][1], path[i - 1][2], path[i][1], path[i][2]);
    const h = Math.max((path[i][0] - path[i - 1][0]) / 3600, 1e-6);
    spds.push((km / h) * 0.53996); // km/h → kt
  }
  const W = 320, H = 110, P = 8, n = alts.length;
  const x = (i) => P + (i / (n - 1)) * (W - 2 * P);
  const maxA = Math.max(...alts, 1);
  const maxS = Math.max(...spds, 1);
  const pl = (arr, max) =>
    arr.map((v, i) => `${x(i).toFixed(1)},${(H - P - (v / max) * (H - 2 * P)).toFixed(1)}`).join(' ');
  const dur = (path[n - 1][0] - path[0][0]) / 3600;
  document.getElementById('profileBody').innerHTML = `
    <div class="headline">${m.headline}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%">
      <polyline points="${pl(alts, maxA)}" fill="none" stroke="var(--cyan)" stroke-width="1.5"/>
      <polyline points="${pl(spds, maxS)}" fill="none" stroke="var(--amber)" stroke-width="1.5"/>
    </svg>
    <div class="kv"><b style="color:var(--cyan)">ALTITUDE max</b><span>${Math.round(maxA).toLocaleString()} ft</span></div>
    <div class="kv"><b style="color:var(--amber)">GND SPEED max</b><span>${Math.round(maxS)} kt</span></div>
    <div class="kv"><b>TRACK</b><span>${dur.toFixed(1)} h · ${n} waypoints</span></div>`;
  document.getElementById('profile').style.display = 'block';
}

/* ═══════════ WEATHER ROSE + METAR/TAF DECODING ════════════════ */
// Compass rose with the wind arrow flying downwind (dir = direction FROM).
function windRose(dir, speedTxt) {
  if (dir == null || isNaN(dir)) return '';
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((a) => `<line x1="0" y1="-50" x2="0" y2="${a % 90 ? -46 : -41}" transform="rotate(${a})"/>`)
    .join('');
  return `<div class="rose"><svg viewBox="-62 -62 124 124" width="118" height="118">
    <circle r="50"/>
    <g class="rose-t">${ticks}</g>
    <text class="rose-l" y="-53">N</text><text class="rose-l" x="56" y="4">E</text>
    <text class="rose-l" y="60">S</text><text class="rose-l" x="-56" y="4">W</text>
    <g transform="rotate(${dir})" class="rose-a">
      <line x1="0" y1="-44" x2="0" y2="26"/><path d="M0,40 L-6,25 L6,25 Z"/>
    </g>
    <text class="rose-s" y="-12">${speedTxt}</text>
    <text class="rose-d" y="0">${Math.round(dir)}°</text>
  </svg></div>`;
}

// WMO weather-code → plain English (Open-Meteo current.weather_code).
function wmoDesc(code) {
  const t = {
    0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
    56: 'freezing drizzle', 57: 'heavy freezing drizzle', 61: 'light rain', 63: 'rain',
    65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain', 71: 'light snow',
    73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers',
    82: 'violent showers', 85: 'snow showers', 86: 'heavy snow showers',
    95: 'thunderstorm', 96: 'thunderstorm w/ hail', 99: 'severe thunderstorm w/ hail',
  }[code];
  return t ? `<div class="note">CONDITIONS: ${t.toUpperCase()}</div>` : '';
}

// METAR wx-group tokens → words ("-SHRA" → "light showers rain").
const WX_CODES = {
  RA: 'rain', SN: 'snow', DZ: 'drizzle', FG: 'fog', BR: 'mist', HZ: 'haze',
  TS: 'thunderstorm', SH: 'showers', FZ: 'freezing', GR: 'hail', GS: 'small hail',
  PL: 'ice pellets', IC: 'ice crystals', SQ: 'squalls', FC: 'funnel cloud',
  DS: 'duststorm', SS: 'sandstorm', DU: 'dust', SA: 'sand', FU: 'smoke',
  VA: 'volcanic ash', PO: 'dust whirls', VC: 'nearby', MI: 'shallow',
  BC: 'patches of', DR: 'drifting', BL: 'blowing', UP: 'unknown precip',
};
function decodeWx(s = '') {
  return s
    .split(' ')
    .map((tok) => {
      const out = [];
      let t = tok;
      if (t.startsWith('+')) { out.push('heavy'); t = t.slice(1); }
      else if (t.startsWith('-')) { out.push('light'); t = t.slice(1); }
      for (let i = 0; i < t.length; i += 2) out.push(WX_CODES[t.slice(i, i + 2)] ?? t.slice(i, i + 2));
      return out.join(' ');
    })
    .join(', ');
}

// Live METAR/TAF for a clicked airport, decoded field by field, plus a
// runway diagram with the into-wind (plausible active) runways highlighted.
async function renderMetar(apt) {
  const el = () => document.getElementById('metar');
  try {
    const arr = await (await fetch(`${CONFIG.AIRPORTS.avwx}?ids=${apt.icao}`)).json();
    const o = Array.isArray(arr) ? arr[0] : null;
    if (!el()) return; // detail panel moved on
    if (!o) {
      el().textContent = 'No METAR published for this field.';
      runwayDiagram(apt, NaN, NaN).then((html) => {
        if (el() && html) el().innerHTML = 'No METAR published for this field.' + html;
      });
      return;
    }
    const kv = (k, v) => `<div class="kv"><b>${k}</b><span>${v ?? '—'}</span></div>`;
    const clouds =
      (o.clouds || []).map((c) => `${c.cover}${c.base ? ` @ ${c.base.toLocaleString()} ft` : ''}`).join(', ') ||
      'clear';
    const wind =
      o.wdir === 'VRB'
        ? `variable @ ${o.wspd ?? 0} kt`
        : `${o.wdir ?? '—'}° @ ${o.wspd ?? 0} kt${o.wgst ? ` gust ${o.wgst}` : ''}`;
    el().innerHTML =
      `<div style="color:var(--amber);margin-bottom:4px">METAR — DECODED</div>` +
      windRose(o.wdir === 'VRB' ? null : o.wdir, `${o.wspd ?? 0} kt${o.wgst ? ' G' + o.wgst : ''}`) +
      kv('WIND', wind) +
      kv('VISIBILITY', o.visib != null ? String(o.visib).replace('+', '≥') + ' sm' : '—') +
      (o.wxString ? kv('WEATHER', decodeWx(o.wxString)) : '') +
      kv('CLOUDS', clouds) +
      kv('TEMP / DEWPOINT', `${o.temp ?? '—'} °C / ${o.dewp ?? '—'} °C`) +
      kv('ALTIMETER', o.altim ? Math.round(o.altim) + ' hPa' : '—') +
      kv('OBSERVED', o.reportTime ? o.reportTime + 'Z' : '—') +
      `<div class="metar-raw">${o.rawOb ?? ''}</div>` +
      (o.rawTaf
        ? `<div style="color:var(--amber);margin:7px 0 3px">TAF — RAW</div><div class="metar-raw">${o.rawTaf}</div>`
        : '') +
      `<div id="rwyDiag"></div>`;
    const wdir = o.wdir === 'VRB' ? NaN : +o.wdir;
    runwayDiagram(apt, wdir, +o.wspd || 0).then((html) => {
      const d = document.getElementById('rwyDiag');
      if (d && html) d.innerHTML = html;
    });
  } catch (_) {
    if (el()) el().textContent = 'METAR lookup failed (aviationweather.gov).';
  }
}

/* ═══════════════════ REGION FOCUS MODE ════════════════════════ */
let camTarget = null;

// Fly the camera to a lat/lon (used by alert click-to-locate).
function flyTo(lat, lon, dist = 190) {
  pivot.set(0, 0, 0); // release any object orbit
  camMode = 'globe';
  camTarget = {
    theta: (-lon * Math.PI) / 180,
    phi: ((90 - lat) * Math.PI) / 180,
    dist,
  };
}

// Resolve an alert's contact to its CURRENT position. Alerts are fired where the
// event happened (e.g. where a 7700 squawk began), but the contact has since
// moved — so re-find it live by icao/mmsi. Returns {lat,lon} or null if gone.
function liveContactPos(ref) {
  if (!ref) return null;
  if (ref.icao) {
    for (const id of ['AIR', 'MILAIR'])
      for (const m of ctx.metaFor(id))
        if (m.icao === ref.icao && m.lat != null) return { lat: m.lat, lon: m.lon };
  }
  if (ref.mmsi != null) {
    for (const id of ['SEA', 'DARK'])
      for (const m of ctx.metaFor(id))
        if (m.mmsi === ref.mmsi && m.lat != null) return { lat: m.lat, lon: m.lon };
  }
  return null;
}

const regionSel = document.getElementById('regionSel');
Object.keys(REGIONS).forEach((k) => regionSel.insertAdjacentHTML('beforeend', `<option>${k}</option>`));
regionSel.addEventListener('change', () => {
  activeRegion = REGIONS[regionSel.value];
  pivot.set(0, 0, 0); // region flight is a globe-orbit move
  camMode = 'globe';
  if (activeRegion) {
    camTarget = {
      theta: (-activeRegion.lon * Math.PI) / 180,
      phi: ((90 - activeRegion.lat) * Math.PI) / 180,
      dist: activeRegion.dist,
    };
    ui.tick(`Region focus — ${regionSel.value} · ADS-B narrowed to bbox (cheap pulls, faster refresh)`);
  } else {
    camTarget = { theta: camTheta, phi: 1.15, dist: 320 };
    ui.tick('Region focus cleared — global sweep');
  }
  registry.setInterval('AIR', activeRegion ? CONFIG.AIR.regionRefreshMs : CONFIG.AIR.refreshMs);
  registry.notifyRegion();
  ctx.refilterAll(); // hide out-of-region points on every layer (SAT keeps LOS)
});

/* ═══════════════ QUAKE MAGNITUDE FILTER ═══════════════════════ */
document.getElementById('magFilter').addEventListener('input', (e) => {
  CONFIG.QUAKE.minMag = +e.target.value;
  document.getElementById('magVal').textContent = (+e.target.value).toFixed(1);
  registry.get('QUAKE')?.refilter?.(ctx); // re-render from cache, no refetch
});


/* ═══════ PANELS: DRAG THE TITLE TO MOVE, CLICK IT TO COLLAPSE ═ */
// Every .panel gets: drag on its title bar to reposition (persisted), and a
// plain click on the title to collapse to just the bar (▾/▸ indicator).
function makePanels() {
  const saved = JSON.parse(localStorage.getItem('sentinel.panels') || '{}');
  const save = () => localStorage.setItem('sentinel.panels', JSON.stringify(saved));
  for (const el of document.querySelectorAll('.panel')) {
    const h = el.querySelector('h2');
    if (!h || !el.id) continue;
    const st = (saved[el.id] ??= {});
    if (st.left != null) {
      el.style.left = st.left + 'px';
      el.style.top = st.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
    // SOCINT is a stub — starts collapsed so it can't cover real panels
    // (e.g. the airport diagram in CONTACT DETAIL).
    if (st.min ?? el.id === 'socint') el.classList.add('min');
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.close, #ackAll')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const offX = e.clientX - r.left;
      const offY = e.clientY - r.top;
      const x0 = e.clientX, y0 = e.clientY;
      let dragged = false;
      const move = (ev) => {
        if (!dragged && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
        dragged = true;
        el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - offX)) + 'px';
        el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - offY)) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        if (dragged) {
          st.left = parseInt(el.style.left, 10);
          st.top = parseInt(el.style.top, 10);
        } else {
          el.classList.toggle('min');
          st.min = el.classList.contains('min');
        }
        save();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }
}

/* ═══════════════ CARTOGRAPHY TOGGLES ══════════════════════════ */
let nationNamesOn = true;
document.getElementById('lblNations').addEventListener('change', (e) => {
  nationNamesOn = e.target.checked;
});

/* ═══════════════ CONTACT FILTERS + SEARCH ═════════════════════ */
ctx.contactFilter = contactPasses;
const fNat = document.getElementById('fNat');
for (const [code, label] of Object.entries(NAT_OPTIONS))
  fNat.insertAdjacentHTML('beforeend', `<option value="${code}">${label}</option>`);
function applyContactFilters() {
  FILTER.nat = fNat.value;
  FILTER.mil = document.getElementById('fMil').value;
  FILTER.watchOnly = document.getElementById('fWatch').checked;
  FILTER.movingOnly = document.getElementById('fMove').checked;
  FILTER.altBand = document.getElementById('fAlt').value;
  FILTER.orbitBand = document.getElementById('fOrbit').value;
  ctx.refilterAll();
}
for (const id of ['fNat', 'fMil', 'fWatch', 'fMove', 'fAlt', 'fOrbit'])
  document.getElementById(id).addEventListener('change', applyContactFilters);

// Contact search: Enter finds the first vessel/aircraft/airport/satellite
// matching name / MMSI / callsign / ICAO hex, flies there and opens detail.
document.getElementById('searchBox').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toUpperCase();
  if (!q) return;
  const matches = [];
  for (const id of ['SEA', 'DARK', 'AIR', 'APT', 'SAT'])
    for (const m of ctx.metaFor(id)) {
      const hay = `${m.headline ?? ''} ${m.callsign ?? ''} ${m.icao ?? ''} ${m.mmsi ?? ''}`.toUpperCase();
      if (hay.includes(q)) matches.push(m);
    }
  if (!matches.length) return ui.tick(`Search — no contact matching “${q}”`);
  const m = matches[0];
  if (m.lat != null) flyTo(m.lat, m.lon, 30);
  onPick(m);
  ui.tick(`Search — ${matches.length} match${matches.length > 1 ? 'es' : ''}, showing ${m.headline}`);
});

/* ═══════════════════════ 4D TIMELINE ══════════════════════════ */
const Timeline = {
  buf: [],
  record() {
    if (scrubT !== null && this.buf.length >= CONFIG.TIMELINE.maxSnapshots) return;
    const air = ctx.live.get('AIR');
    const seaL = ctx.live.get('SEA');
    this.buf.push({ t: Date.now(), AIR: air, SEA: seaL });
    Archive.put('snapshots', { t: Date.now(), air: air?.meta.length || 0, sea: seaL?.meta.length || 0 });
    if (this.buf.length > CONFIG.TIMELINE.maxSnapshots) this.buf.shift();
  },
  nearest(t) {
    let best = null, d = Infinity;
    for (const s of this.buf) {
      const dd = Math.abs(s.t - t);
      if (dd < d) {
        d = dd;
        best = s;
      }
    }
    return best;
  },
  apply(t) {
    scrubT = t;
    const memStart = this.buf[0]?.t ?? Infinity;
    if (t >= memStart) {
      const s = this.nearest(t);
      if (s) {
        if (s.AIR) ctx.setLayerData('AIR', s.AIR.pos, s.AIR.meta);
        if (s.SEA) ctx.setLayerData('SEA', s.SEA.pos, s.SEA.meta);
      }
    } else {
      // Beyond the in-memory buffer: pull the nearest DVR frame (1-min grain,
      // positions + headlines only).
      DVR.nearest(t).then((f) => {
        if (!f || scrubT !== t) return; // stale by the time it resolved
        for (const id of ['AIR', 'SEA'])
          if (f[id])
            ctx.setLayerData(
              id,
              f[id].pos,
              f[id].heads.map((h) => ({
                layer: id,
                headline: h,
                rows: { NOTE: 'DVR frame — position + identity only', TIME: new Date(f.t).toUTCString() },
              })),
            );
      });
    }
    registry.notifyScrub(t); // seismic filters to ≤t, satellites propagate to t
    document.getElementById('liveBtn').classList.add('paused');
    const dt = Math.round((Date.now() - t) / 60e3);
    document.getElementById('scrubLabel').textContent =
      dt < 1 ? 'T−0 min' : dt < 120 ? `T−${dt} min` : `T−${(dt / 60).toFixed(1)} h`;
  },
  live() {
    scrubT = null;
    ctx.restoreLive('AIR');
    ctx.restoreLive('SEA');
    registry.notifyScrub(null);
    document.getElementById('liveBtn').classList.remove('paused');
    document.getElementById('scrubLabel').textContent = 'NOW';
    document.getElementById('scrub').value = 1000;
  },
};
setInterval(() => Timeline.record(), CONFIG.TIMELINE.snapshotMs);
document.getElementById('scrub').addEventListener('input', (e) => {
  const frac = e.target.value / 1000;
  if (frac >= 0.999) return Timeline.live();
  // Slider spans the DVR window, not just the in-memory buffer.
  const start = Date.now() - DVR.hours * 3600e3;
  Timeline.apply(start + frac * (Date.now() - start));
});
document.getElementById('liveBtn').addEventListener('click', () => Timeline.live());

/* ═══════════════ LOCAL LLM INTEL REPORTS (Ollama) ═════════════ */
function buildSitrep() {
  const top = (arr, n = 8) => arr.slice(0, n).map((x) => '- ' + x.headline).join('\n') || '- none';
  const m = (id) => ctx.metaFor(id);
  const quakes = [...m('QUAKE')].sort((a, b) => (b.rows.MAG || 0) - (a.rows.MAG || 0));
  const jam = m('JAMMING');
  const zones = jam.filter((x) => x.rows?.TYPE === 'GPS DENIED ZONE');
  const fires = m('FIRMS');
  const bigFires = [...fires].sort(
    (a, b) => (parseFloat(b.rows?.['FIRE POWER']) || 0) - (parseFloat(a.rows?.['FIRE POWER']) || 0),
  );
  // Lead with the fusion: alerts that are inherently high-signal (dark ship,
  // STS, loiter, resurface, emergency squawk) OR that the backend enriched with
  // cross-layer context ('⚠' marker added by maritime normalizeAlert). These
  // are the "why this matters" items the report should open on.
  const hiSignal = Alerts.log.filter(
    (a) => /DARK|STS|LOITER|RESURFACE|EMERGENCY/i.test(a.title) || (a.msg || '').includes('⚠'),
  );
  const hiText =
    hiSignal.slice(0, 10).map((a) => `- ${a.title}: ${a.msg}`).join('\n') ||
    '- none currently flagged';
  return `SNAPSHOT: ${new Date().toUTCString()}
REGION FOCUS: ${regionSel.value}

*** HIGH-SIGNAL & CROSS-LAYER-CORRELATED EVENTS — LEAD THE SITREP WITH THESE ***
(dark/STS/loiter/resurface/emergency events; '⚠' marks a contact whose event
coincides in space with a GPS-denied zone and/or a conflict cluster)
${hiText}

FORCE LAYDOWN & ENVIRONMENT:
SATELLITES TRACKED: ${m('SAT').length}
CIVIL AIRCRAFT ON PLOT: ${m('AIR').length}${activeRegion ? ' (region bbox)' : ''}
MILITARY AIRCRAFT ON PLOT: ${m('MILAIR').length}
${top(m('MILAIR'), 6)}
VESSELS${CONFIG.SEA.live ? ' (LIVE AIS)' : ' (SIMULATED)'}: ${m('SEA').length}
DARK SHIPS (AIS blackout while underway): ${m('DARK').length}
${top(m('DARK'), 6)}
GPS-DENIED ZONES: ${zones.length}${zones.length ? ' — ' + zones.map((z) => z.headline.replace('⛔ ', '')).slice(0, 4).join('; ') : ''}
SIGNIFICANT FIRES/THERMAL: ${fires.length} — largest:
${top(bigFires, 5)}
SEISMIC EVENTS LAST 24H (M≥${CONFIG.QUAKE.minMag}): ${m('QUAKE').length} — strongest:
${top(quakes, 5)}
OPEN NATURAL EVENTS (EONET): ${m('EVENTS').length}
${top(m('EVENTS'), 5)}
CONFLICT/UNREST CLUSTERS (GDELT 24h): ${m('CONFLICT').length}
${top(m('CONFLICT'), 6)}
UPCOMING LAUNCHES: ${m('LAUNCH').length}
RECENT ALERTS (with cross-layer correlation where flagged):
${Alerts.log.slice(0, 8).map((a) => '- ' + a.title + ': ' + a.msg).join('\n') || '- none'}`;
}
let reportBusy = false;
// Stream a prompt through the backend Ollama proxy into `el`, token by token.
// Shared by the SITREP report and the per-nation dossier briefs.
async function streamLLM(prompt, el) {
  el.textContent = 'Querying local model (Ollama)… first token can take a few seconds.';
  try {
    const r = await fetch(CONFIG.LLM.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', out = '';
    el.textContent = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.response) {
            out += j.response;
            el.textContent = out;
            el.scrollTop = el.scrollHeight;
          }
        } catch (_) {}
      }
    }
    if (!out) el.textContent = '(model returned no text — is the model pulled? `ollama pull llama3.1:8b`)';
    return out;
  } catch (e) {
    el.textContent =
      `Local model unavailable via the backend proxy (${CONFIG.LLM.endpoint}): ${e.message}\n\n` +
      'Install Ollama (ollama.com/download), `ollama pull llama3.1:8b`, ensure `ollama serve` is ' +
      'running, then retry. Set OLLAMA_MODEL in .env for a different model.';
    return '';
  }
}

async function generateReport() {
  if (reportBusy) return;
  reportBusy = true;
  const btn = document.getElementById('reportBtn');
  document.getElementById('report').style.display = 'block';
  btn.disabled = true;
  try {
    await streamLLM(
      'You are the watch officer of a geospatial intelligence operations center. ' +
        'Write a concise SITREP with exactly three sections: HEADLINE, KEY DEVELOPMENTS, WATCH ITEMS. ' +
        'Prioritize the highest-signal items: military aircraft, dark ships, GPS-denied zones, ' +
        'conflict clusters, large fires, and any alert with cross-layer correlation. ' +
        'Be factual and terse; do not invent data. If vessels are simulated, say so. Sensor snapshot:\n\n' +
        buildSitrep(),
      document.getElementById('reportBody'),
    );
  } finally {
    reportBusy = false;
    btn.disabled = false;
  }
}
document.getElementById('reportBtn').addEventListener('click', generateReport);

/* ═══════════════════════ ALERT ENGINE ═════════════════════════ */
const Alerts = {
  log: [],
  seen: new Set(),
  async armNotify() {
    if (CONFIG.ALERTS.notify && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (_) {}
    }
  },
  fire(title, msg, lat, lon, ref) {
    const key = title + '|' + msg;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    // `ref` ({icao} or {mmsi}) lets a click re-resolve to the contact's live
    // position instead of where the alert was born.
    const rec = { title, msg, lat, lon, ref, t: Date.now() };
    this.log.unshift(rec);
    if (this.log.length > 60) this.log.pop();
    ui.tick(`⚠ ${title} — ${msg}`);
    ui.renderAlerts();
    Archive.put('alerts', rec);
    dossiers.ingestAlert(rec); // attribute to a flag state → per-nation dossier
    if (CONFIG.ALERTS.notify && 'Notification' in window && Notification.permission === 'granted')
      try {
        new Notification('ARGUS — ' + title, { body: msg });
      } catch (_) {}
  },
  ack(i) {
    if (this.log[i]) this.log[i].acked = true;
    ui.renderAlerts();
  },
  ackAll() {
    for (const a of this.log) a.acked = true;
    ui.renderAlerts();
  },
  remove(i) {
    this.log.splice(i, 1); // `seen` keeps its key, so it won't re-fire
    ui.renderAlerts();
  },
  checkSquawks(meta) {
    for (const mm of meta) {
      const sq = mm.rows.SQUAWK;
      if (['7500', '7600', '7700'].includes(sq))
        this.fire('EMERGENCY SQUAWK', `${mm.headline} squawking ${sq}`, mm.lat ?? null, mm.lon ?? null, {
          icao: mm.icao,
        });
    }
  },
  checkQuake(q) {
    if (q.rows.MAG >= CONFIG.ALERTS.quakeMag)
      this.fire('SEISMIC', `M${q.rows.MAG} — ${q.headline.replace(/^M[\d.]+ — /, '')}`, q.lat ?? null, q.lon ?? null);
  },
  checkLaunch(l, lat, lon) {
    const dt = (new Date(l.net) - Date.now()) / 60e3;
    if (dt > 0 && dt < 30) this.fire('LAUNCH IMMINENT', `${l.name} — T−${dt.toFixed(0)} min`, lat, lon);
  },
};
ctx.alerts = Alerts;

/* ═══════════════ LONG-TERM ARCHIVE (IndexedDB) ════════════════ */
const Archive = {
  db: null,
  open() {
    if (!CONFIG.ARCHIVE.enabled || !('indexedDB' in window)) return;
    try {
      const rq = indexedDB.open(CONFIG.ARCHIVE.db, 2);
      rq.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of ['snapshots', 'alerts', 'quakes', 'dvr'])
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 't' });
      };
      rq.onsuccess = (e) => {
        this.db = e.target.result;
        ui.info('Archive online — history persisting to IndexedDB');
      };
      rq.onerror = () => {};
    } catch (_) {}
  },
  put(store, rec) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).put(rec);
    } catch (_) {}
  },
};

/* ═══════════════ DVR — LONG-HORIZON RECORDER ══════════════════ */
// One compact frame a minute (positions + headlines for AIR/SEA) into
// IndexedDB, pruned past 48 h. The 4D scrubber falls back to these frames
// when dragged beyond the fine-grained in-memory buffer (~50 min).
const DVR = {
  hours: Math.min(48, Math.max(1, +(localStorage.getItem('sentinel.dvrHours') || CONFIG.DVR.retainHours))),
  record() {
    if (!Archive.db) return;
    const frame = { t: Date.now() };
    for (const id of ['AIR', 'SEA']) {
      const l = ctx.live.get(id);
      if (l) frame[id] = { pos: l.pos, heads: l.meta.map((m) => m.headline) };
    }
    Archive.put('dvr', frame);
    // prune anything older than the hard 48 h ceiling
    try {
      const tx = Archive.db.transaction('dvr', 'readwrite');
      tx.objectStore('dvr').delete(IDBKeyRange.upperBound(Date.now() - 48 * 3600e3));
    } catch (_) {}
  },
  // Nearest stored frame within ±10 min of t (async).
  nearest(t) {
    return new Promise((res) => {
      if (!Archive.db) return res(null);
      try {
        const rq = Archive.db
          .transaction('dvr')
          .objectStore('dvr')
          .getAll(IDBKeyRange.bound(t - 600e3, t + 600e3));
        rq.onsuccess = () => {
          let best = null;
          for (const f of rq.result) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
          res(best);
        };
        rq.onerror = () => res(null);
      } catch (_) {
        res(null);
      }
    });
  },
};
setInterval(() => DVR.record(), CONFIG.DVR.cadenceMs);
const dvrInput = document.getElementById('dvrHours');
dvrInput.value = DVR.hours;
dvrInput.addEventListener('change', () => {
  DVR.hours = Math.min(48, Math.max(1, +dvrInput.value || CONFIG.DVR.retainHours));
  dvrInput.value = DVR.hours;
  localStorage.setItem('sentinel.dvrHours', DVR.hours);
  ui.tick(`DVR window — scrubber now reaches ${DVR.hours} h back`);
});

// Export the current global picture as a JSON snapshot download.
document.getElementById('snapBtn').addEventListener('click', () => {
  const out = { t: new Date().toISOString(), layers: {} };
  for (const [id, L] of ctx.layers) if (L.meta.length) out.layers[id] = L.meta.map((m) => ({ headline: m.headline, ...m.rows }));
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sentinel-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  ui.tick('Snapshot exported — full global picture as JSON');
});

/* ═════════════ SATELLITE IMAGERY OVERLAY (NASA GIBS) ══════════ */
// Three basemap modes, cycled by the IMAGERY button:
//   OFF  — dark tactical basemap (default)
//   HD   — Blue Marble shaded-relief+bathymetry, 8K static composite.
//          No swath gaps, google-maps-like fidelity; not current-day.
//   LIVE — yesterday's MODIS true-color at 4K. Real imagery, but polar-orbit
//          swaths leave diagonal gaps near the equator.
const Imagery = {
  modes: ['OFF', 'HD', 'LIVE'],
  idx: 0,
  cache: {}, // mode -> THREE.Texture (so cycling back is instant)
  gibs(layers, w, h, time) {
    return (
      `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?` +
      `SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layers}` +
      `&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/jpeg` +
      (time ? `&TIME=${time}` : '')
    );
  },
  url(mode, fallback = false) {
    if (mode === 'HD')
      return this.gibs('BlueMarble_ShadedRelief_Bathymetry', fallback ? 4096 : 8192, fallback ? 2048 : 4096);
    const d = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    return this.gibs('MODIS_Terra_CorrectedReflectance_TrueColor', 4096, 2048, d);
  },
};
function applyBasemap(tex) {
  globeMesh.material.map = tex;
  globeMesh.material.color.setHex(tex ? 0xffffff : 0x0c1620);
  globeMesh.material.needsUpdate = true;
}
function cycleImagery() {
  Imagery.idx = (Imagery.idx + 1) % Imagery.modes.length;
  const mode = Imagery.modes[Imagery.idx];
  const btn = document.getElementById('imgBtn');
  const label = () => (btn.textContent = '🛰 IMAGERY: ' + mode);
  btn.classList.toggle('on', mode !== 'OFF');
  if (mode === 'OFF') {
    applyBasemap(null);
    return label();
  }
  if (Imagery.cache[mode]) {
    applyBasemap(Imagery.cache[mode]);
    return label();
  }
  btn.textContent = '🛰 LOADING ' + mode + '…';
  const loader = new THREE.TextureLoader().setCrossOrigin('anonymous');
  const onLoad = (tex) => {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.colorSpace = THREE.SRGBColorSpace;
    Imagery.cache[mode] = tex;
    applyBasemap(tex);
    label();
    ui.tick(mode === 'HD' ? 'Blue Marble 8K basemap — static composite, gap-free' : 'MODIS true-color — yesterday, 4K');
  };
  loader.load(Imagery.url(mode), onLoad, undefined, () => {
    // 8K request refused/offline? Retry HD at 4K before giving up.
    if (mode === 'HD')
      loader.load(Imagery.url(mode, true), onLoad, undefined, () => {
        label();
        ui.tick('GIBS imagery blocked (CORS/offline) — keeping dark basemap');
      });
    else {
      label();
      ui.tick('GIBS imagery blocked (CORS/offline) — keeping dark basemap');
    }
  });
}
document.getElementById('imgBtn').addEventListener('click', cycleImagery);

/* ═════════════════════════ BOOT ═══════════════════════════════ */
ui.init(); // build sidebar + status dots (now that Alerts/Archive exist)
makePanels(); // panels: drag title to move, click title to collapse (persisted)
// Dev/debug handle — inspect scene + layers from the console.
window.__argus = { scene, camera, ctx, registry, tripwires, orbitWatch, dossiers, get pivot() { return pivot; }, get camMode() { return camMode; } };
Alerts.armNotify();
Archive.open();
registry.init(); // one-time setup (aircraft trails, sea relay connection)
registry.start(); // initial load + auto-refresh timers for every layer
setInterval(() => registry.tickAll(), CONFIG.SAT.propagateMs); // satellite propagation

// render loop (globe slowly rotates when idle; camera flies to region targets)
let lastInteract = Date.now();
addEventListener('pointerdown', () => {
  lastInteract = Date.now();
  camTarget = null;
});
let lastArrowRescale = 0;
(function loop() {
  requestAnimationFrame(loop);
  const now = Date.now();
  if (camTarget) {
    camTheta += (camTarget.theta - camTheta) * 0.08;
    camPhi += (camTarget.phi - camPhi) * 0.08;
    camDist += (camTarget.dist - camDist) * 0.08;
    if (Math.abs(camTarget.theta - camTheta) < 1e-3 && Math.abs(camTarget.dist - camDist) < 0.5)
      camTarget = null;
    placeCamera();
  } else if (
    Date.now() - lastInteract > 8000 &&
    !activeRegion &&
    !orbiting() &&
    camDist - R > 100
  ) {
    camTheta += 0.0006; // idle drift only at global altitudes
    placeCamera();
  }
  // Deep-zoom chrome: once the camera settles, refresh the tile patch under it;
  // below ~95 km altitude hide the graticule/coastlines (imagery replaces them).
  // Ground point + altitude derive from the camera position so they stay right
  // while orbiting a focused object too.
  const cr = camera.position.length();
  if (Date.now() - camMovedAt > 250) {
    // Drive the tile/building overlays from the point the camera is LOOKING at
    // (screen-centre ray → sphere), not the point directly beneath it — else a
    // tilted free-look view renders the ground under your feet, not the scene
    // ahead. Falls back to the nadir when the view misses the globe (horizon/sky).
    _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const b = camera.position.dot(_camFwd);
    const disc = b * b - (camera.position.lengthSq() - R * R);
    const gp =
      disc >= 0
        ? camera.position.clone().addScaledVector(_camFwd, -b - Math.sqrt(disc))
        : camera.position.clone().normalize().multiplyScalar(R);
    const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, gp.y / R))) * 180) / Math.PI;
    let lon = (Math.atan2(gp.z, -gp.x) * 180) / Math.PI - 180;
    if (lon < -180) lon += 360;
    tiles.update(lat, lon, cr - R);
    buildings.update(lat, lon, cr - R);
  }
  const lowAlt = cr - R < 1.5;
  gratGrp.visible = !lowAlt;
  if (coastGrp) coastGrp.visible = !lowAlt;
  // Nation names: font scales with altitude, and label density follows
  // LABELRANK so small-nation clusters (Europe, Caribbean) don't overlap
  // until you're close enough for them to separate. Hidden on deep zoom.
  const alt = cr - R;
  // Base arrow world-size ∝ altitude so chevrons hold a roughly constant SCREEN
  // size (like the point sprites). Each layer's own iconScale is applied on top
  // in registry.rescaleArrows / _plot.
  ctx.markerScale = Math.max(0.015, Math.min(14, alt * 0.010));
  if (now - lastArrowRescale > 150) {
    ctx.rescaleArrows();
    lastArrowRescale = now;
  }
  nationLbls.visible = nationNamesOn && alt > 8;
  if (nationLbls.visible) {
    const s = Math.max(0.45, Math.min(2.2, alt / 220));
    const maxRank = alt > 350 ? 2 : alt > 180 ? 3 : alt > 90 ? 4 : alt > 45 ? 5 : alt > 20 ? 6 : 10;
    for (const sp of nationLbls.children) {
      sp.visible = sp.userData.rank <= maxRank;
      if (sp.visible) sp.scale.set(sp.userData.base.x * s, sp.userData.base.y * s, 1);
    }
  }
  // City names scale ∝ altitude too — without this the fixed world-size labels
  // balloon to fill the screen at deep zoom (camera sits metres from them).
  // Resolve the group through the registry (reliable across HMR reloads).
  const cityGrp = registry.get('CITY')?.lblGrp;
  if (cityGrp?.visible) {
    const s = Math.max(0.04, Math.min(1.6, alt / 150));
    for (const sp of cityGrp.children) {
      const b = sp.userData.base;
      if (b) sp.scale.set(b.x * s, b.y * s, 1);
    }
  }
  renderer.render(scene, camera);
})();
