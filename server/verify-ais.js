#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// aisstream schema check — RUN THIS FIRST when you get online.
//
//   node server/verify-ais.js
//
// It connects to aisstream.io, captures a handful of real messages, and verifies
// that the fields server/ais.js reads (MetaData.MMSI/latitude/longitude/ShipName,
// Message.PositionReport.Sog/Cog/TrueHeading, Message.ShipStaticData.*) actually
// exist in the live payload. If aisstream changed their schema, this tells you
// exactly which path drifted so you can fix _ingest() in one place.
//
// Needs AISSTREAM_KEY in .env (or the environment). Exits non-zero on failure so
// you can wire it into CI or a pre-flight check.
// ─────────────────────────────────────────────────────────────────────────────
import { CONFIG } from './config.js'; // loads .env (BOM-tolerant) from repo root
import WebSocket from 'ws';

const KEY = CONFIG.aisstreamKey;
const SAMPLE_TARGET = 8; // messages to inspect before deciding
const TIMEOUT_MS = 30_000;

if (!KEY) {
  console.error('✗ No AISSTREAM_KEY set. Put it in .env, then re-run.');
  process.exit(2);
}

// The exact accessor paths server/ais.js depends on. Keep in sync with _ingest().
const CHECKS = {
  'MetaData.MMSI': (m) => m.MetaData?.MMSI ?? m.Metadata?.MMSI,
  'MetaData.latitude': (m) => m.MetaData?.latitude ?? m.Metadata?.latitude,
  'MetaData.longitude': (m) => m.MetaData?.longitude ?? m.Metadata?.longitude,
  'MetaData.ShipName': (m) => m.MetaData?.ShipName ?? m.Metadata?.ShipName,
  'MessageType': (m) => m.MessageType,
  'Message.PositionReport.Sog': (m) => m.Message?.PositionReport?.Sog,
  'Message.PositionReport.Cog': (m) => m.Message?.PositionReport?.Cog,
  'Message.PositionReport.TrueHeading': (m) => m.Message?.PositionReport?.TrueHeading,
  'Message.PositionReport.NavigationalStatus': (m) =>
    m.Message?.PositionReport?.NavigationalStatus,
  'Message.ShipStaticData.Type': (m) => m.Message?.ShipStaticData?.Type,
  'Message.ShipStaticData.Destination': (m) => m.Message?.ShipStaticData?.Destination,
};

const seen = {}; // path -> true if a non-null value was observed at least once
for (const k of Object.keys(CHECKS)) seen[k] = false;

let count = 0;
let sawPositionReport = false;
let sawStaticData = false;
const messageTypes = new Set();

console.log('→ Connecting to aisstream.io …');
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

const timer = setTimeout(() => {
  console.error(`✗ Timed out after ${TIMEOUT_MS / 1000}s with ${count} messages.`);
  console.error('  Either the key is invalid, or no traffic in the bounding box.');
  finish(3);
}, TIMEOUT_MS);

ws.on('open', () => {
  console.log('✓ Connected. Subscribing to a busy box (Singapore Strait) …');
  ws.send(
    JSON.stringify({
      APIKey: KEY,
      // Singapore Strait: essentially always has live traffic.
      BoundingBoxes: [[[1.0, 103.4], [1.5, 104.2]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }),
  );
});

ws.on('message', (buf) => {
  let m;
  try {
    m = JSON.parse(buf.toString());
  } catch {
    console.warn('  (non-JSON frame ignored)');
    return;
  }
  // aisstream sends an error frame if the key/subscription is bad.
  if (m.error || m.Error) {
    console.error('✗ aisstream error:', m.error || m.Error);
    return finish(2);
  }

  count++;
  if (m.MessageType) messageTypes.add(m.MessageType);
  if (m.Message?.PositionReport) sawPositionReport = true;
  if (m.Message?.ShipStaticData) sawStaticData = true;

  for (const [path, get] of Object.entries(CHECKS)) {
    const val = get(m);
    if (val !== undefined && val !== null && val !== '') seen[path] = true;
  }

  if (count === 1) {
    console.log('\n── First raw message (top-level keys) ──');
    console.log('  ', Object.keys(m).join(', '));
  }

  if (count >= SAMPLE_TARGET && sawPositionReport) finish(0);
});

ws.on('error', (e) => {
  console.error('✗ Websocket error:', e.message);
  finish(3);
});

function finish(code) {
  clearTimeout(timer);
  try {
    ws.close();
  } catch {}

  console.log(`\n── Results after ${count} message(s) ──`);
  console.log('  MessageTypes seen:', [...messageTypes].join(', ') || '(none)');
  console.log('  PositionReport observed:', sawPositionReport ? 'yes' : 'NO');
  console.log('  ShipStaticData observed:', sawStaticData ? 'yes' : 'no (may need longer)');
  console.log('\n  Field paths used by ais.js:');

  let missingCore = false;
  const CORE = new Set([
    'MetaData.MMSI',
    'MetaData.latitude',
    'MetaData.longitude',
    'Message.PositionReport.Sog',
  ]);
  for (const [path, ok] of Object.entries(seen)) {
    const core = CORE.has(path);
    const mark = ok ? '✓' : core ? '✗' : '·';
    console.log(`    ${mark} ${path}${ok ? '' : core ? '  <-- CORE FIELD MISSING' : '  (not seen — may be sparse)'}`);
    if (core && !ok) missingCore = true;
  }

  if (code === 0 && !missingCore) {
    console.log('\n✓ SCHEMA OK — ais.js field paths match the live feed.');
    process.exit(0);
  } else if (missingCore) {
    console.log('\n✗ SCHEMA DRIFT — a core field is missing. Update _ingest() in');
    console.log('  server/ais.js to match the raw message shape printed above.');
    process.exit(1);
  } else {
    process.exit(code);
  }
}
