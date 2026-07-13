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
  CREATE INDEX IF NOT EXISTS alerts_t ON alerts (t);
`);
// Migration: older DBs lack the lat/lon columns the pattern-of-life bbox query
// needs. ADD COLUMN is a no-op-with-error if they already exist — swallow it.
for (const col of ['lat REAL', 'lon REAL']) {
  try { db.exec(`ALTER TABLE alerts ADD COLUMN ${col}`); } catch (_) {}
}

const insFix = db.prepare('INSERT INTO fixes VALUES (?,?,?,?)');
const selTrack = db.prepare(
  'SELECT t, lat, lon FROM fixes WHERE mmsi = ? AND t > ? ORDER BY t',
);
const insAlert = db.prepare('INSERT INTO alerts (t, kind, mmsi, payload, lat, lon) VALUES (?,?,?,?,?,?)');

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
    insAlert.run(
      Date.now(),
      a.kind ?? '?',
      a.vessel?.mmsi ?? null,
      JSON.stringify(a),
      a.vessel?.lat ?? null,
      a.vessel?.lon ?? null,
    );
  } catch (_) {}
}

// Pattern-of-life query: archived alerts filtered by time / kind / bbox.
// bbox = [lamin, lomin, lamax, lomax] (region convention). Newest first.
export function queryAlerts({ sinceMs, untilMs = Date.now(), kind, bbox, limit = 500 } = {}) {
  let sql = 'SELECT t, kind, mmsi, lat, lon, payload FROM alerts WHERE t >= ? AND t <= ?';
  const args = [sinceMs, untilMs];
  if (kind) { sql += ' AND kind = ?'; args.push(kind); }
  if (bbox && bbox.length === 4) {
    sql += ' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?';
    args.push(bbox[0], bbox[2], bbox[1], bbox[3]);
  }
  sql += ' ORDER BY t DESC LIMIT ?';
  args.push(limit);
  return db.prepare(sql).all(...args).map((r) => {
    let p = {};
    try { p = JSON.parse(r.payload); } catch (_) {}
    return {
      t: r.t, kind: r.kind, mmsi: r.mmsi, lat: r.lat, lon: r.lon,
      name: p.vessel?.name || null,
      minutes: p.minutes, meters: p.meters, jumpNm: p.jumpNm,
      context: p.context || [],
    };
  });
}

// Kind histogram over the last `sinceMs` (for the history panel summary).
export function alertKinds(sinceMs = Date.now() - 30 * 864e5) {
  try {
    return db.prepare('SELECT kind, COUNT(*) n FROM alerts WHERE t >= ? GROUP BY kind ORDER BY n DESC').all(sinceMs);
  } catch (_) {
    return [];
  }
}

// Rolling retention, once an hour.
setInterval(() => {
  try {
    db.prepare('DELETE FROM fixes WHERE t < ?').run(Date.now() - 48 * 3600e3);
    db.prepare('DELETE FROM alerts WHERE t < ?').run(Date.now() - 30 * 864e5);
  } catch (_) {}
}, 3600e3).unref();
