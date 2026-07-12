// Live maritime client. Connects to the SENTINEL backend's websocket relay,
// keeps a local vessel map in sync, and hands clean arrays to the caller.
// Pure module: no THREE / DOM dependency, so it stays testable and reusable.
//
// Usage (from main.js):
//   const mar = connectMaritime({
//     url: 'ws://localhost:8787/ws',
//     onUpdate(vessels, dark) { /* plot them */ },
//     onAlert(alert)          { /* dark / resurface */ },
//     onStatus(status)        { /* 'ok' | 'connecting' | 'down' */ },
//   });
//   mar.close();  // to disconnect

export function connectMaritime({ url, onUpdate, onAlert, onStatus, snapshotUrl }) {
  const vessels = new Map(); // mmsi -> vessel
  const dark = new Map();    // mmsi -> vessel (dark)
  let ws = null;
  let backoff = 1000;
  let closed = false;
  let flushTimer = null;

  // Coalesce rapid updates into one render call every 500ms.
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      onUpdate?.([...vessels.values()], [...dark.values()]);
    }, 500);
  }

  function applyVessel(v) {
    if (v.dark) {
      vessels.delete(v.mmsi);
      dark.set(v.mmsi, v);
    } else {
      dark.delete(v.mmsi);
      vessels.set(v.mmsi, v);
    }
  }

  function connect() {
    onStatus?.('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      return retry();
    }

    ws.onopen = () => {
      backoff = 1000;
      onStatus?.('ok');
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'snapshot') {
        vessels.clear();
        dark.clear();
        for (const v of msg.vessels || []) vessels.set(v.mmsi, v);
        for (const v of msg.dark || []) dark.set(v.mmsi, v);
        scheduleFlush();
      } else if (msg.type === 'update') {
        for (const v of msg.vessels || []) applyVessel(v);
        scheduleFlush();
      } else if (msg.type === 'alert') {
        applyVessel(msg.vessel);
        onAlert?.(normalizeAlert(msg));
        scheduleFlush();
      }
    };

    ws.onclose = () => retry();
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }

  function retry() {
    if (closed) return;
    onStatus?.('down');
    backoff = Math.min(backoff * 2, 20_000);
    setTimeout(connect, backoff);
  }

  // Optional: seed from REST before the socket opens (nice for slow links).
  if (snapshotUrl) {
    fetch(snapshotUrl)
      .then((r) => r.json())
      .then((s) => {
        for (const v of s.vessels || []) vessels.set(v.mmsi, v);
        for (const v of s.dark || []) dark.set(v.mmsi, v);
        scheduleFlush();
      })
      .catch(() => {});
  }

  connect();

  return {
    close() {
      closed = true;
      clearTimeout(flushTimer);
      try {
        ws?.close();
      } catch {}
    },
    stats: () => ({ live: vessels.size, dark: dark.size }),
  };
}

function normalizeAlert(msg) {
  const v = msg.vessel || {};
  const who = v.name || `MMSI ${v.mmsi}`;
  // Cross-layer correlation context appended by the backend (GPS-jamming
  // zones / conflict clusters near the event) — high value, surface verbatim.
  const ctxNote = msg.context?.length ? ` — ⚠ ${msg.context.join('; ')}` : '';
  if (msg.kind === 'dark') {
    return {
      title: 'DARK SHIP',
      msg: `${who} went silent while underway${ctxNote}`,
      lat: v.lat,
      lon: v.lon,
      mmsi: v.mmsi,
      kind: 'dark',
    };
  }
  if (msg.kind === 'sts') {
    const w = msg.vessel2 || {};
    return {
      title: 'STS TRANSFER CANDIDATE',
      msg: `${who} + ${w.name || 'MMSI ' + w.mmsi} stationary ${msg.meters} m apart ~${msg.minutes} min, open water${ctxNote}`,
      lat: v.lat,
      lon: v.lon,
      mmsi: v.mmsi,
      kind: 'sts',
    };
  }
  return {
    title: 'AIS RESURFACE',
    msg: `${who} reappeared after ${msg.darkMinutes} min, ${msg.jumpNm} nm from last fix${ctxNote}`,
    lat: v.lat,
    lon: v.lon,
    kind: 'resurface',
  };
}
