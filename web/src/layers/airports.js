import { CONFIG } from '../config.js';

// Airports — OurAirports open dataset (keyless, CORS-enabled GitHub Pages
// mirror). Large + medium fields only (~5k points); small strips would drown
// the plot. Static data: loaded once, no refresh interval. Clicking a field
// pulls live METAR/TAF through the backend proxy (see main.js renderMetar).

// Quote-aware CSV line splitter (airport names contain commas).
function csvSplit(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export default {
  id: 'APT',
  name: 'Airports',
  color: 0x6f9fc8,
  css: '#6f9fc8',
  size: 3,

  async load(ctx) {
    ctx.ui.status('APT', 'wait');
    try {
      const txt = await (await fetch(CONFIG.AIRPORTS.url)).text();
      const lines = txt.split('\n');
      const head = csvSplit(lines[0]);
      const col = (n) => head.indexOf(n);
      const cType = col('type'), cIdent = col('ident'), cName = col('name');
      const cLat = col('latitude_deg'), cLon = col('longitude_deg');
      const cElev = col('elevation_ft'), cCountry = col('iso_country');
      const cCity = col('municipality'), cIata = col('iata_code');
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const c = csvSplit(lines[i]);
        const type = c[cType];
        if (type !== 'large_airport' && type !== 'medium_airport') continue;
        const lat = +c[cLat], lon = +c[cLon];
        if (!isFinite(lat) || !isFinite(lon)) continue;
        rows.push({ c, type, lat, lon });
      }
      const pos = new Float32Array(rows.length * 3);
      const meta = [];
      rows.forEach((r, i) => {
        const v = ctx.llToV(r.lat, r.lon, ctx.R + 0.06);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        meta.push({
          layer: 'APT',
          icao: r.c[cIdent],
          lat: r.lat,
          lon: r.lon,
          headline: `${r.c[cIdent]} — ${r.c[cName]}`,
          rows: {
            TYPE: r.type === 'large_airport' ? 'AIRPORT (LARGE)' : 'AIRPORT (MEDIUM)',
            ICAO: r.c[cIdent] || '—',
            IATA: r.c[cIata] || '—',
            CITY: r.c[cCity] || '—',
            COUNTRY: r.c[cCountry] || '—',
            ELEV: r.c[cElev] ? r.c[cElev] + ' ft' : '—',
            SOURCE: 'OurAirports',
          },
        });
      });
      ctx.setLayerData('APT', pos, meta);
      ctx.ui.status('APT', 'ok');
      ctx.ui.info(`Airports — ${rows.length} large/medium fields plotted`);
    } catch (e) {
      ctx.ui.status('APT', 'err');
      ctx.ui.tick('OurAirports dataset unreachable');
    }
  },
};
