import { unzipSync, strFromU8 } from 'fflate';

// Conflict/unrest events from the GDELT 2.0 EVENTS bulk feed.
//
// GDELT's old GEO 2.0 JSON API (api.gdeltproject.org/api/v2/geo/geo) is dead —
// it 404s on every query form. The raw 15-minute bulk files are alive and
// well, so we ingest those instead: each ~85 KB export.CSV.zip is the global
// event table for one 15-minute window, CAMEO-coded and geocoded.
//
// We keep a rolling 24 h store of conflict-class events — threats and military
// force posture (mobilizations, exercises, ultimatums) through protest,
// coercion, assault, fighting and mass violence — cluster them to half-degree
// cells with their actors, and serve the clusters to the frontend. On first
// call we backfill the last 3 h so the layer starts populated.

const ROOT = 'http://data.gdeltproject.org/gdeltv2/';
const LASTUPDATE = ROOT + 'lastupdate.txt';
// CAMEO root codes: 13 threaten, 14 protest, 15 force posture, 17 coerce,
// 18 assault, 19 fight, 20 mass violence. 13/15 are what lift the layer from
// street-level unrest to the interstate picture (sabre-rattling, build-ups).
const CONFLICT_ROOTS = new Set(['13', '14', '15', '17', '18', '19', '20']);
const KEEP_MS = 24 * 3600e3;
const BACKFILL_STEPS = 12; // 12 × 15 min = 3 h
const REFRESH_MS = 15 * 60e3;

const events = new Map(); // GlobalEventID -> { lat, lon, place, root, articles, url, t }
const ingested = new Set(); // file timestamps already processed
let lastRefresh = 0;

function stampToDate(stamp) {
  // "20260708151500" -> Date (UTC)
  return new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T` +
      `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`,
  );
}

function dateToStamp(d) {
  return d.toISOString().replace(/[-T:]/g, '').slice(0, 14);
}

async function ingestFile(stamp) {
  if (ingested.has(stamp)) return;
  ingested.add(stamp); // even on failure — don't hammer missing files
  const res = await fetch(`${ROOT}${stamp}.export.CSV.zip`);
  if (!res.ok) return;
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const name = Object.keys(zip)[0];
  if (!name) return;
  const t = stampToDate(stamp).getTime();
  for (const line of strFromU8(zip[name]).split('\n')) {
    const c = line.split('\t');
    if (c.length < 61) continue;
    const root = c[28]; // EventRootCode
    if (!CONFLICT_ROOTS.has(root)) continue;
    const lat = parseFloat(c[56]); // ActionGeo_Lat
    const lon = parseFloat(c[57]); // ActionGeo_Long
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    events.set(c[0], {
      lat,
      lon,
      place: c[52] || '—', // ActionGeo_FullName
      root,
      a1: c[6] || null, // Actor1Name — who did it
      a2: c[16] || null, // Actor2Name — to whom
      articles: +c[33] || 1, // NumArticles
      url: c[60] || null, // SOURCEURL
      t,
    });
  }
}

function evict() {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, e] of events) if (e.t < cutoff) events.delete(id);
}

const ROOT_LABEL = {
  13: 'THREAT',
  14: 'PROTEST',
  15: 'FORCE POSTURE',
  17: 'COERCION',
  18: 'ASSAULT',
  19: 'FIGHTING',
  20: 'MASS VIOLENCE',
};

function clusters(max = 400) {
  const cells = new Map(); // "lat,lon" (0.5°) -> cluster
  for (const e of events.values()) {
    const key = `${Math.round(e.lat * 2) / 2},${Math.round(e.lon * 2) / 2}`;
    let c = cells.get(key);
    if (!c) {
      c = { lat: 0, lon: 0, events: 0, articles: 0, tops: [], kinds: {} };
      cells.set(key, c);
    }
    c.events++;
    c.articles += e.articles;
    c.lat += e.lat;
    c.lon += e.lon;
    c.kinds[ROOT_LABEL[e.root]] = (c.kinds[ROOT_LABEL[e.root]] || 0) + 1;
    // Keep the cluster's 3 most-covered events for the detail panel.
    c.tops.push(e);
    if (c.tops.length > 3) {
      c.tops.sort((a, b) => b.articles - a.articles);
      c.tops.length = 3;
    }
  }
  return [...cells.values()]
    .sort((a, b) => b.articles - a.articles)
    .slice(0, max)
    .map((c) => {
      const top = c.tops.sort((a, b) => b.articles - a.articles)[0];
      return {
        lat: +(c.lat / c.events).toFixed(3),
        lon: +(c.lon / c.events).toFixed(3),
        events: c.events,
        articles: c.articles,
        place: top.place,
        kind: Object.entries(c.kinds).sort((a, b) => b[1] - a[1])[0][0],
        kinds: c.kinds,
        // Headline actors from the most-covered event (GDELT names are UPPERCASE).
        actors: top.a1 ? (top.a2 && top.a2 !== top.a1 ? `${top.a1} ⇄ ${top.a2}` : top.a1) : null,
        url: top.url,
        top: c.tops.map((e) => ({
          kind: ROOT_LABEL[e.root],
          actors: e.a1 ? (e.a2 && e.a2 !== e.a1 ? `${e.a1} ⇄ ${e.a2}` : e.a1) : null,
          articles: e.articles,
          url: e.url,
        })),
      };
    });
}

export async function getConflict() {
  if (Date.now() - lastRefresh > REFRESH_MS) {
    lastRefresh = Date.now();
    // Current file from the manifest, then walk back for any missed windows.
    let stamp = null;
    try {
      const txt = await (await fetch(LASTUPDATE)).text();
      stamp = txt.match(/(\d{14})\.export\.CSV\.zip/)?.[1] ?? null;
    } catch (_) {}
    if (stamp) {
      const t0 = stampToDate(stamp).getTime();
      const stamps = Array.from({ length: BACKFILL_STEPS + 1 }, (_, i) =>
        dateToStamp(new Date(t0 - i * 15 * 60e3)),
      );
      await Promise.allSettled(stamps.map((s) => ingestFile(s)));
    }
    evict();
  }
  if (!events.size) throw new Error('no GDELT events ingested');
  return { updated: lastRefresh, events: events.size, points: clusters() };
}
