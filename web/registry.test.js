// Registry / LayerContext tests. These validate the layer architecture wiring
// without a browser or THREE renderer, using a minimal fake scene + THREE stub.
//   node --test   (run from web/)
//
// We can't import registry.js directly here because it imports 'three' (an npm
// package resolved by Vite, not present in a bare `node --test`). Instead we
// re-implement the tiny contracts the registry guarantees and assert on them.
// If registry.js changes its interface, update this to match — it documents the
// expected behavior for layer authors.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal re-creation of the context contract layers rely on ──────────────
function makeContext() {
  const layers = new Map();
  const live = new Map();
  const statuses = {};
  const counts = {};
  const ui = {
    status: (id, s) => (statuses[id] = s),
    count: (id, n) => (counts[id] = n),
    tick: () => {},
  };
  let scrubT = null;
  const ctx = {
    ui,
    R: 100,
    llToV: (lat, lon, r = 100) => ({ x: lat, y: lon, z: r }), // shape only
    layers,
    live,
    _register(def) {
      layers.set(def.id, { def, meta: [], visible: !def.disabled });
    },
    setLayerData(id, pos, meta) {
      const L = layers.get(id);
      if (L) {
        L.meta = meta;
        ui.count(id, meta.length);
      }
    },
    setLive(id, pos, meta) {
      live.set(id, { pos, meta });
      if (scrubT === null) ctx.setLayerData(id, pos, meta);
    },
    restoreLive(id) {
      const l = live.get(id);
      if (l) ctx.setLayerData(id, l.pos, l.meta);
    },
    setVisible(id, on) {
      const L = layers.get(id);
      if (L) L.visible = on;
    },
    metaFor: (id) => layers.get(id)?.meta ?? [],
    scrubTime: () => scrubT,
    region: () => null,
    _setScrub: (t) => (scrubT = t),
    _statuses: statuses,
    _counts: counts,
  };
  return ctx;
}

test('registering a layer creates a tracked entry', () => {
  const ctx = makeContext();
  ctx._register({ id: 'TEST', name: 'Test', disabled: false });
  assert.ok(ctx.layers.has('TEST'));
  assert.equal(ctx.layers.get('TEST').visible, true);
});

test('disabled layer registers hidden', () => {
  const ctx = makeContext();
  ctx._register({ id: 'OFF', name: 'Off', disabled: true });
  assert.equal(ctx.layers.get('OFF').visible, false);
});

test('setLayerData updates meta and count', () => {
  const ctx = makeContext();
  ctx._register({ id: 'A' });
  ctx.setLayerData('A', new Float32Array(6), [{ headline: 'x' }, { headline: 'y' }]);
  assert.equal(ctx.metaFor('A').length, 2);
  assert.equal(ctx._counts['A'], 2);
});

test('setLive records to live store and renders when not scrubbing', () => {
  const ctx = makeContext();
  ctx._register({ id: 'B' });
  ctx.setLive('B', new Float32Array(3), [{ headline: 'z' }]);
  assert.equal(ctx.live.get('B').meta.length, 1);
  assert.equal(ctx.metaFor('B').length, 1);
});

test('setLive does NOT render live frame while scrubbing, restoreLive brings it back', () => {
  const ctx = makeContext();
  ctx._register({ id: 'C' });
  ctx.setLive('C', new Float32Array(3), [{ headline: 'live-A' }]); // rendered (live)
  ctx._setScrub(Date.now() - 60000); // enter scrub
  ctx.setLive('C', new Float32Array(3), [{ headline: 'live-B' }, { headline: 'live-C' }]);
  // While scrubbing, the display should still show the pre-scrub frame...
  assert.equal(ctx.metaFor('C').length, 1, 'scrub freezes the displayed frame');
  // ...but the live store captured the newer frame.
  assert.equal(ctx.live.get('C').meta.length, 2);
  // Returning to live restores the latest captured frame.
  ctx._setScrub(null);
  ctx.restoreLive('C');
  assert.equal(ctx.metaFor('C').length, 2);
});

test('setVisible toggles a layer', () => {
  const ctx = makeContext();
  ctx._register({ id: 'D' });
  ctx.setVisible('D', false);
  assert.equal(ctx.layers.get('D').visible, false);
  ctx.setVisible('D', true);
  assert.equal(ctx.layers.get('D').visible, true);
});

// A layer module is just an object with an id and a load()/hooks. Verify the
// seismic module's shape as a representative example (pure import, no THREE).
test('a layer module exposes id + load + optional hooks', async () => {
  const seismic = (await import('./src/layers/seismic.js')).default;
  assert.equal(seismic.id, 'QUAKE');
  assert.equal(typeof seismic.load, 'function');
  assert.equal(typeof seismic.onScrub, 'function');
});

test('sea module declares DARK as a companion layer', async () => {
  const sea = (await import('./src/layers/sea.js')).default;
  assert.equal(sea.id, 'SEA');
  assert.ok(Array.isArray(sea.companions));
  assert.equal(sea.companions[0].id, 'DARK');
});
