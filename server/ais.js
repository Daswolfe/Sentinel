import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';
import WebSocket from 'ws';
import { CONFIG } from './config.js';
import { loadPorts } from './ports.js';

const here = dirname(fileURLToPath(import.meta.url));
// Capture/replay paths from .env resolve against server/, not the launch cwd.
const dataPath = (p) => resolve(here, p);

const KTS_MIN = CONFIG.ais.underwaySog;
const DARK_MS = CONFIG.ais.darkThresholdMin * 60_000;
const EVICT_MS = CONFIG.ais.staleEvictMin * 60_000;

// Great-circle distance in nautical miles (for resurface jump reporting).
function haversineNm(a, b) {
  const R = 3440.065; // Earth radius in nm
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * AisRelay connects to aisstream.io, tracks every vessel it hears, and derives
 * two things the raw feed does not give you:
 *   • a clean, deduplicated live picture (one record per MMSI), and
 *   • DARK SHIP events — vessels that were underway, then stopped transmitting
 *     for longer than the threshold, which is the classic AIS-off tradecraft
 *     used for sanctions evasion and covert ship-to-ship transfers.
 *
 * Emits:
 *   'update' -> Array<vessel>   (batched deltas since last broadcast)
 *   'alert'  -> { kind:'dark'|'resurface', vessel, ... }
 *   'status' -> 'ok' | 'connecting' | 'error'
 */
export class AisRelay extends EventEmitter {
  constructor() {
    super();
    this.vessels = new Map(); // mmsi -> vessel record
    this.dirty = new Set();   // mmsi changed since last broadcast
    this.ports = loadPorts(); // for suppressing in-port silences
    this.ws = null;
    this.backoff = 1000;
    this.started = false;
    this.stats = { messages: 0, darkFlagged: 0, darkSuppressed: 0, resurfaced: 0 };
  }

  // Replay mode needs no aisstream key — the file IS the feed.
  get enabled() {
    return Boolean(CONFIG.aisstreamKey || CONFIG.ais.replay);
  }

  get mode() {
    return CONFIG.ais.replay ? 'replay' : CONFIG.ais.record ? 'record' : 'live';
  }

  start() {
    if (!this.enabled) {
      this.emit('status', 'disabled');
      return;
    }
    if (this.started) return;
    this.started = true;
    if (CONFIG.ais.record && !CONFIG.ais.replay)
      this._rec = createWriteStream(dataPath(CONFIG.ais.record), { flags: 'a' });
    if (CONFIG.ais.replay) this._startReplay();
    else this._connect();
    this._scanTimer = setInterval(() => this._scanDark(), CONFIG.ais.scanIntervalMs);
    this._castTimer = setInterval(() => this._broadcast(), CONFIG.ais.broadcastMs);
    this._evictTimer = setInterval(() => this._evict(), 5 * 60_000);
  }

  stop() {
    clearInterval(this._scanTimer);
    clearInterval(this._castTimer);
    clearInterval(this._evictTimer);
    if (this.ws) this.ws.close();
    if (this._rec) { this._rec.end(); this._rec = null; }
    this.started = false;
  }

  /* ── recorded-scenario replay (Theme 4.20) ─────────────────────────
   * Streams an NDJSON capture ({"t":epochMs,"m":<raw aisstream msg>} per
   * line) through the SAME _ingest path as the live websocket, honouring the
   * recorded inter-message gaps ÷ replaySpeed. Loops at EOF with a clean
   * vessel table so back-jumping positions can't fire bogus resurface alerts.
   */
  async _startReplay() {
    const path = dataPath(CONFIG.ais.replay);
    const speed = CONFIG.ais.replaySpeed;
    this.emit('status', 'ok');
    while (this.started) {
      let t0 = null;
      const wall0 = Date.now();
      try {
        const rl = readline.createInterface({
          input: createReadStream(path),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!this.started) return;
          let rec;
          try { rec = JSON.parse(line); } catch { continue; }
          if (rec?.t == null || !rec.m) continue;
          t0 ??= rec.t;
          const wait = wall0 + (rec.t - t0) / speed - Date.now();
          if (wait > 5) await new Promise((r) => setTimeout(r, wait));
          this._ingest(rec.m);
        }
      } catch (e) {
        this.emit('status', 'error');
        console.log(`  • AIS   replay failed: ${e.message}`);
        return;
      }
      if (t0 == null) {
        this.emit('status', 'error');
        console.log('  • AIS   replay file empty or not NDJSON capture format');
        return;
      }
      // Tape rewind: hold the final picture briefly, then start clean so the
      // back-jump to the first frame can't fire bogus resurface alerts (and a
      // tiny capture can't hot-loop the process).
      await new Promise((r) => setTimeout(r, 2000));
      this.vessels.clear();
      this.dirty.clear();
    }
  }

  _connect() {
    this.emit('status', 'connecting');
    const ws = new WebSocket(CONFIG.ais.endpoint);
    this.ws = ws;

    ws.on('open', () => {
      this.backoff = 1000;
      ws.send(
        JSON.stringify({
          APIKey: CONFIG.aisstreamKey,
          BoundingBoxes: CONFIG.ais.boxes,
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }),
      );
      this.emit('status', 'ok');
    });

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      // Scenario capture: raw message + arrival time, one JSON per line.
      if (this._rec) this._rec.write(`{"t":${Date.now()},"m":${JSON.stringify(msg)}}\n`);
      this._ingest(msg);
    });

    ws.on('close', () => this._reconnect());
    ws.on('error', () => {
      this.emit('status', 'error');
      // 'close' fires after 'error'; reconnect handled there.
    });
  }

  _reconnect() {
    if (!this.started) return;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    setTimeout(() => this._connect(), this.backoff);
  }

  // Normalize an aisstream message into our vessel record. aisstream nests the
  // authoritative position/name/time in MetaData, and per-type fields in Message.
  // (Schema per aisstream.io docs — verify against current docs if fields drift.)
  _ingest(msg) {
    const meta = msg.MetaData || msg.Metadata;
    if (!meta) return;
    const mmsi = meta.MMSI ?? meta.mmsi;
    const lat = meta.latitude ?? meta.Latitude;
    const lon = meta.longitude ?? meta.Longitude;
    if (mmsi == null || lat == null || lon == null) return;

    this.stats.messages++;
    const now = Date.now();
    const pr =
      msg.Message?.PositionReport ||
      msg.Message?.StandardClassBPositionReport ||
      {};
    const stat = msg.Message?.ShipStaticData;

    let v = this.vessels.get(mmsi);
    if (!v) {
      if (this.vessels.size >= CONFIG.ais.maxVessels) return; // memory guard
      v = { mmsi, reports: 0, dark: false, darkAt: null, firstSeen: now };
      this.vessels.set(mmsi, v);
    }

    // Any fresh transmission clears a prior in-port suppression: if this vessel
    // later goes silent somewhere else, it's eligible to be flagged again.
    v.suppressed = null;

    // If a dark vessel transmits again, it has "resurfaced" — a high-value signal.
    if (v.dark) {
      const jumped = haversineNm({ lat: v.lat, lon: v.lon }, { lat, lon });
      const darkMin = Math.round((now - v.darkAt) / 60_000);
      v.dark = false;
      v.darkAt = null;
      this.stats.resurfaced++;
      this.emit('alert', {
        kind: 'resurface',
        vessel: this._pub(v),
        darkMinutes: darkMin,
        jumpNm: Math.round(jumped),
      });
    }

    v.lat = lat;
    v.lon = lon;
    v.sog = pr.Sog ?? pr.sog ?? v.sog ?? 0;
    v.cog = pr.Cog ?? pr.cog ?? v.cog ?? null;
    v.heading = pr.TrueHeading ?? v.heading ?? null;
    v.navStatus = pr.NavigationalStatus ?? v.navStatus ?? null;
    v.name = (meta.ShipName || v.name || '').trim();
    if (stat) {
      v.type = stat.Type ?? v.type ?? null;
      v.callsign = stat.CallSign?.trim() || v.callsign || null;
      v.destination = stat.Destination?.trim() || v.destination || null;
    }
    v.lastSeen = now;
    v.reports += 1;
    // Breadcrumb track for the path-on-click feature: one fix every ≥5 min,
    // capped at 72 (~6 h). ~30k live vessels × 72 × 3 numbers stays modest.
    if (!v.track) v.track = [];
    if (!v.track.length || now - v.track[v.track.length - 1][0] > 5 * 60_000) {
      v.track.push([now, +lat.toFixed(4), +lon.toFixed(4)]);
      if (v.track.length > 72) v.track.shift();
      this.emit('fix', mmsi, now, v.track[v.track.length - 1][1], v.track[v.track.length - 1][2]);
    }
    this.dirty.add(mmsi);
  }

  // Flag vessels that were underway and have now gone silent past the threshold —
  // unless they went quiet in/near a known port or anchorage (legitimate silence).
  _scanDark() {
    const now = Date.now();
    for (const v of this.vessels.values()) {
      if (v.dark) continue;
      if (v.reports < CONFIG.ais.minReportsBeforeDark) continue;
      const wasUnderway = (v.sog ?? 0) >= KTS_MIN;
      if (!wasUnderway || now - v.lastSeen <= DARK_MS) continue;

      const port = this.ports.nearest(v.lat, v.lon);
      if (port) {
        // Silence explained by a berth/anchorage — not evasion. Suppress once.
        if (!v.suppressed) {
          v.suppressed = port.name;
          this.stats.darkSuppressed++;
        }
        continue;
      }

      v.dark = true;
      v.darkAt = now;
      this.dirty.add(v.mmsi);
      this.stats.darkFlagged++;
      this.emit('alert', { kind: 'dark', vessel: this._pub(v) });
    }
  }

  _evict() {
    const now = Date.now();
    for (const [mmsi, v] of this.vessels) {
      if (now - v.lastSeen > EVICT_MS) this.vessels.delete(mmsi);
    }
  }

  _broadcast() {
    if (!this.dirty.size) return;
    const batch = [];
    for (const mmsi of this.dirty) {
      const v = this.vessels.get(mmsi);
      if (v) batch.push(this._pub(v));
    }
    this.dirty.clear();
    if (batch.length) this.emit('update', batch);
  }

  // Public shape sent to clients (compact, no internal bookkeeping).
  _pub(v) {
    return {
      mmsi: v.mmsi,
      name: v.name || null,
      type: v.type ?? null,
      lat: v.lat,
      lon: v.lon,
      sog: v.sog ?? null,
      cog: v.cog ?? null,
      heading: v.heading ?? null,
      navStatus: v.navStatus ?? null,
      destination: v.destination ?? null,
      dark: v.dark,
      darkAt: v.darkAt,
      lastSeen: v.lastSeen,
    };
  }

  snapshot() {
    const live = [];
    const dark = [];
    for (const v of this.vessels.values()) {
      (v.dark ? dark : live).push(this._pub(v));
    }
    return { vessels: live, dark };
  }
}
