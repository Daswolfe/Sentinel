// Bike-share stations aggregated from GBFS (General Bikeshare Feed Spec).
//
// The MobilityData catalog lists 1,500+ systems; loading all is absurd, so we
// curate a set of major dock-based city systems by System ID and resolve their
// (authoritative, current) auto-discovery URLs from the catalog — so a URL
// change upstream doesn't break us. For each system we merge station_information
// (locations) with station_status (live bikes/docks) and return a flat list.
// Aggregating server-side also sidesteps the per-operator CORS lottery.

const CATALOG = 'https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv';

// Curated station-based systems (System IDs from the catalog).
const CURATED = new Set([
  'lyft_nyc',            // Citi Bike (New York)
  'lyft_chi',            // Divvy (Chicago)
  'lyft_bay',            // Bay Wheels (San Francisco)
  'MEX',                 // Ecobici (Mexico City)
  'bike_buenosaires',    // Ecobici (Buenos Aires)
  'bike_share_toronto',  // Bike Share Toronto
  'Bixi_MTL',            // BIXI (Montréal)
  'Paris',               // Vélib' Métropole (Paris)
  'dublin',              // Dublinbikes
  'cogo',                // CoGo (Columbus)
  'bcycle_indego',       // Indego (Philadelphia)
  'bcycle_lametro',      // Metro Bike Share (Los Angeles)
]);

const CATALOG_TTL = 24 * 3600e3;
const DATA_TTL = 2 * 60e3;
const MAX_STATIONS = 25000;

let catalog = { t: 0, rows: null };
let cache = { t: 0, out: null };

function csvSplit(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function getCatalog() {
  if (catalog.rows && Date.now() - catalog.t < CATALOG_TTL) return catalog.rows;
  const text = await (await fetch(CATALOG)).text();
  const lines = text.split('\n');
  const head = csvSplit(lines[0]);
  const iId = head.indexOf('System ID');
  const iName = head.indexOf('Name');
  const iDisc = head.indexOf('Auto-Discovery URL');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = csvSplit(lines[i]);
    rows.push({ id: c[iId], name: c[iName], disc: c[iDisc] });
  }
  catalog = { t: Date.now(), rows };
  return rows;
}

// GBFS name fields are a string (v2) or an array of {text,language} (v3).
const gbfsName = (n) => (Array.isArray(n) ? n[0]?.text : n) || '';

async function stationsFor(sysName, discUrl) {
  const disc = await (await fetch(discUrl)).json();
  const d = disc.data || {};
  const feeds = d.feeds || d[Object.keys(d)[0]]?.feeds || [];
  const infoUrl = feeds.find((f) => f.name === 'station_information')?.url;
  const statusUrl = feeds.find((f) => f.name === 'station_status')?.url;
  if (!infoUrl) return [];
  const [info, status] = await Promise.all([
    (await fetch(infoUrl)).json(),
    statusUrl ? (await fetch(statusUrl)).json() : Promise.resolve(null),
  ]);
  const stat = new Map();
  for (const s of status?.data?.stations || []) stat.set(s.station_id, s);
  const out = [];
  for (const s of info.data?.stations || []) {
    if (s.lat == null || s.lon == null) continue;
    const st = stat.get(s.station_id);
    out.push({
      sys: sysName,
      name: gbfsName(s.name).slice(0, 60),
      lat: +s.lat,
      lon: +s.lon,
      cap: s.capacity ?? null,
      bikes: st?.num_bikes_available ?? null,
      docks: st?.num_docks_available ?? null,
    });
  }
  return out;
}

export async function getBikeshare() {
  if (cache.out && Date.now() - cache.t < DATA_TTL) return cache.out;
  const rows = await getCatalog();
  const chosen = rows.filter((r) => CURATED.has(r.id) && /gbfs\.json/.test(r.disc || ''));
  const results = await Promise.allSettled(chosen.map((r) => stationsFor(r.name, r.disc)));
  const stations = [];
  const systems = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value.length) {
      systems.push({ name: chosen[i].name, stations: res.value.length });
      for (const s of res.value) {
        if (stations.length < MAX_STATIONS) stations.push(s);
      }
    }
  });
  const out = { t: Date.now(), systems, count: stations.length, stations };
  cache = { t: Date.now(), out };
  return out;
}
