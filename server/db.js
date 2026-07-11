import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Tier-2 persistence: vessel breadcrumb fixes + alerts survive restarts.
// WAL-mode SQLite in server/data/. Retention is a rolling 48 h for fixes
// (matching the DVR ceiling) and 30 days for alerts.

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'data'), { recursive: true });
const db = new Database(join(here, 'data', 'sentinel.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS fixes (mmsi INTEGER, t INTEGER, lat REAL, lon REAL);
  CREATE INDEX IF NOT EXISTS fixes_mmsi_t ON fixes (mmsi, t);
  CREATE INDEX IF NOT EXISTS fixes_t ON fixes (t);
  CREATE TABLE IF NOT EXISTS alerts (t INTEGER, kind TEXT, mmsi INTEGER, payload TEXT);
`);

const insFix = db.prepare('INSERT INTO fixes VALUES (?,?,?,?)');
const selTrack = db.prepare(
  'SELECT t, lat, lon FROM fixes WHERE mmsi = ? AND t > ? ORDER BY t',
);
const insAlert = db.prepare('INSERT INTO alerts VALUES (?,?,?,?)');

export function saveFix(mmsi, t, lat, lon) {
  try {
    insFix.run(mmsi, t, lat, lon);
  } catch (_) {}
}

export function trackFor(mmsi) {
  return selTrack.all(mmsi, Date.now() - 48 * 3600e3).map((r) => [r.t, r.lat, r.lon]);
}

export function saveAlert(a) {
  try {
    insAlert.run(Date.now(), a.kind ?? '?', a.vessel?.mmsi ?? null, JSON.stringify(a));
  } catch (_) {}
}

// Rolling retention, once an hour.
setInterval(() => {
  try {
    db.prepare('DELETE FROM fixes WHERE t < ?').run(Date.now() - 48 * 3600e3);
    db.prepare('DELETE FROM alerts WHERE t < ?').run(Date.now() - 30 * 864e5);
  } catch (_) {}
}, 3600e3).unref();
