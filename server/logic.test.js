// Backend logic tests — no dependencies, no network.
//   node --test        (from server/)  or  npm test
//
// Covers the parts of the dark-ship pipeline that are pure logic: port matching
// and the underway/silence/suppression decision. The websocket ingest path is
// validated separately and against the live feed by verify-ais.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortIndex, loadPorts } from './ports.js';

test('port index matches known anchorages', () => {
  const p = loadPorts();
  assert.ok(p.count >= 30, 'seed list should have plenty of ports');
  assert.ok(p.nearest(25.15, 56.37), 'Fujairah anchorage should match');
  assert.ok(p.nearest(1.26, 103.83), 'Singapore should match');
});

test('port index rejects open water', () => {
  const p = loadPorts();
  assert.equal(p.nearest(20.0, 62.0), null, 'mid Arabian Sea is not a port');
  assert.equal(p.nearest(-40.0, -30.0), null, 'South Atlantic is not a port');
});

test('port radius is respected at the edge', () => {
  // A tiny custom index: one port with a 5nm radius.
  const p = new PortIndex([['Test', 0, 0, 5]]);
  assert.ok(p.nearest(0, 0), 'dead center matches');
  // ~4nm east (1 nm ≈ 1/60 deg lon at the equator) — inside
  assert.ok(p.nearest(0, 4 / 60), '4nm east is inside 5nm radius');
  // ~10nm east — outside
  assert.equal(p.nearest(0, 10 / 60), null, '10nm east is outside 5nm radius');
});

// Re-implement the pure decision from ais._scanDark so we can test it directly
// without standing up a websocket. Keep in sync with ais.js.
function darkDecision({ sog, silentMin, lat, lon, reports = 5 }, ports, cfg) {
  const now = Date.now();
  const lastSeen = now - silentMin * 60_000;
  if (reports < cfg.minReports) return 'skip';
  const underway = (sog ?? 0) >= cfg.underwaySog;
  if (!underway || now - lastSeen <= cfg.darkMs) return 'not-dark';
  return ports.nearest(lat, lon) ? 'suppressed' : 'dark';
}

const CFG = { minReports: 2, underwaySog: 3, darkMs: 30 * 60_000 };

test('dark decision: underway + silent + open water => dark', () => {
  const ports = loadPorts();
  assert.equal(
    darkDecision({ sog: 14, silentMin: 40, lat: 20, lon: 62 }, ports, CFG),
    'dark',
  );
});

test('dark decision: silent near a port => suppressed', () => {
  const ports = loadPorts();
  assert.equal(
    darkDecision({ sog: 14, silentMin: 40, lat: 25.15, lon: 56.37 }, ports, CFG),
    'suppressed',
  );
});

test('dark decision: recently seen => not dark', () => {
  const ports = loadPorts();
  assert.equal(
    darkDecision({ sog: 18, silentMin: 5, lat: 15, lon: 60 }, ports, CFG),
    'not-dark',
  );
});

test('dark decision: anchored (slow) never goes dark', () => {
  const ports = loadPorts();
  assert.equal(
    darkDecision({ sog: 0.2, silentMin: 90, lat: 15, lon: 60 }, ports, CFG),
    'not-dark',
  );
});

test('dark decision: too few reports is ignored', () => {
  const ports = loadPorts();
  assert.equal(
    darkDecision({ sog: 14, silentMin: 40, lat: 20, lon: 62, reports: 1 }, ports, CFG),
    'skip',
  );
});

// ── Schema lock: real-feed fixture through the real ingest path ─────────
// The fixture mirrors a live aisstream message (verified online 2026-07-09
// by verify-ais.js). If _ingest stops extracting these fields, the feed
// schema or the parser drifted.
test('ingest parses the captured aisstream fixture', async () => {
  const { AisRelay } = await import('./ais.js');
  const fixture = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./fixtures/aisstream-position-report.json', import.meta.url), 'utf8'),
    ),
  );
  const relay = new AisRelay();
  relay._ingest(fixture);
  const v = relay.vessels.get(563012345);
  assert.ok(v, 'vessel record created from fixture');
  assert.equal(v.name, 'ARGUS TEST');
  assert.ok(Math.abs(v.lat - 1.2466) < 1e-9 && Math.abs(v.lon - 103.8303) < 1e-9);
  assert.equal(v.sog, 14.2);
  assert.equal(v.heading, 230);
  assert.equal(v.track.length, 1, 'first fix lands in the breadcrumb track');
});

test('recorded-scenario replay drives the real ingest path from a capture file', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { CONFIG } = await import('./config.js');
  const { AisRelay } = await import('./ais.js');
  const fixture = JSON.parse(
    await fs.readFile(new URL('./fixtures/aisstream-position-report.json', import.meta.url), 'utf8'),
  );
  // Three-message capture: same vessel moving north, 1 s apart on the tape.
  const t0 = Date.now() - 60_000;
  const lines = [0, 1, 2].map((i) => {
    const m = structuredClone(fixture);
    m.MetaData.latitude = 1.2466 + i * 0.01;
    return JSON.stringify({ t: t0 + i * 1000, m });
  });
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'argus-replay-')), 'cap.ndjson');
  await fs.writeFile(file, lines.join('\n') + '\n');

  const saved = { replay: CONFIG.ais.replay, speed: CONFIG.ais.replaySpeed, key: CONFIG.aisstreamKey };
  CONFIG.ais.replay = file;
  CONFIG.ais.replaySpeed = 1000; // 3 s of tape ≈ 3 ms of wall clock
  const relay = new AisRelay();
  try {
    assert.equal(relay.enabled, true, 'replay mode needs no aisstream key');
    assert.equal(relay.mode, 'replay');
    relay.start();
    // Wait for the tape to play through (well under a second at 1000×).
    const until = Date.now() + 2000;
    while (Date.now() < until && (relay.vessels.get(563012345)?.reports ?? 0) < 3)
      await new Promise((r) => setTimeout(r, 20));
    const v = relay.vessels.get(563012345);
    assert.ok(v, 'vessel materialized from the capture');
    assert.equal(v.reports >= 3, true, 'all three taped messages ingested');
    assert.ok(Math.abs(v.lat - 1.2666) < 1e-9, 'latest position wins');
  } finally {
    relay.stop();
    CONFIG.ais.replay = saved.replay;
    CONFIG.ais.replaySpeed = saved.speed;
    CONFIG.aisstreamKey = saved.key;
  }
});
