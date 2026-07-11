import { CONFIG } from './config.js';

// Airport runway diagrams with wind-based runway-in-use estimation.
//
// Geometry comes from OurAirports runways.csv (lazy-fetched once, indexed by
// airport ident). Each runway is drawn to true scale/orientation from its
// end coordinates; the "in use" call is the classic rule of thumb: aircraft
// land and depart INTO the wind, so the favored end of each strip is the one
// whose heading gives a positive headwind component. Below 4 kt it's calm —
// any runway is plausible.

let index = null; // ident -> [runway rows]
let loading = null;

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

async function loadIndex() {
  if (index) return index;
  loading ??= (async () => {
    const txt = await (await fetch(CONFIG.AIRPORTS.runways)).text();
    const lines = txt.split('\n');
    const head = csvSplit(lines[0]);
    const col = Object.fromEntries(head.map((h, i) => [h, i]));
    const idx = new Map();
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const c = csvSplit(lines[i]);
      const ident = c[col.airport_ident];
      if (!ident) continue;
      if (!idx.has(ident)) idx.set(ident, []);
      idx.get(ident).push({
        closed: c[col.closed] === '1',
        lengthFt: +c[col.length_ft] || 0,
        widthFt: +c[col.width_ft] || 0,
        surface: c[col.surface],
        le: {
          id: c[col.le_ident],
          lat: +c[col.le_latitude_deg],
          lon: +c[col.le_longitude_deg],
          hdg: +c[col.le_heading_degT],
        },
        he: {
          id: c[col.he_ident],
          lat: +c[col.he_latitude_deg],
          lon: +c[col.he_longitude_deg],
          hdg: +c[col.he_heading_degT],
        },
      });
    }
    index = idx;
    return idx;
  })();
  return loading;
}

// Heading from a runway ident ("27L" → 270) when the CSV heading is missing.
const identHdg = (id) => {
  const n = parseInt(id, 10);
  return isFinite(n) ? (n * 10) % 360 : null;
};

function headwind(wdir, wspd, hdg) {
  return wspd * Math.cos(((wdir - hdg) * Math.PI) / 180);
}

// Returns HTML for the diagram, or '' when no usable runway data exists.
export async function runwayDiagram(apt, wdir, wspd) {
  let rwys;
  try {
    rwys = (await loadIndex()).get(apt.icao)?.filter((r) => !r.closed) ?? [];
  } catch {
    return '';
  }
  // Need both-end coordinates to draw true geometry; synthesize from heading
  // + length around the field centre when they're missing.
  const strips = [];
  for (const r of rwys) {
    let { le, he } = r;
    const leHdg = isFinite(le.hdg) ? le.hdg : identHdg(le.id);
    const heHdg = isFinite(he.hdg) ? he.hdg : leHdg != null ? (leHdg + 180) % 360 : null;
    if (!isFinite(le.lat) || !isFinite(he.lat)) {
      if (leHdg == null || !r.lengthFt || apt.lat == null) continue;
      const halfDeg = (r.lengthFt * 0.3048) / 2 / 111120; // half-length in ° lat
      const rad = (leHdg * Math.PI) / 180;
      const dLat = Math.cos(rad) * halfDeg;
      const dLon = (Math.sin(rad) * halfDeg) / Math.cos((apt.lat * Math.PI) / 180);
      le = { ...le, lat: apt.lat - dLat, lon: apt.lon - dLon };
      he = { ...he, lat: apt.lat + dLat, lon: apt.lon + dLon };
    }
    strips.push({ ...r, le: { ...le, hdg: leHdg }, he: { ...he, hdg: heHdg } });
  }
  if (!strips.length) return '';

  // Project to a local north-up plane and fit into the viewbox.
  const lat0 = strips.reduce((s, r) => s + r.le.lat + r.he.lat, 0) / (strips.length * 2);
  const lon0 = strips.reduce((s, r) => s + r.le.lon + r.he.lon, 0) / (strips.length * 2);
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const pts = strips.flatMap((r) => [r.le, r.he]);
  const ext = Math.max(
    ...pts.map((p) => Math.abs((p.lon - lon0) * kx)),
    ...pts.map((p) => Math.abs(p.lat - lat0)),
    1e-5,
  );
  const S = 62 / ext; // fit into ±62 of a 160×160 viewbox
  const X = (p) => +((p.lon - lon0) * kx * S).toFixed(1);
  const Y = (p) => +(-(p.lat - lat0) * S).toFixed(1);

  const calm = !isFinite(wdir) || !isFinite(wspd) || wspd < 4;
  let svg = '';
  const uses = [];
  for (const r of strips) {
    const w = Math.max(2, Math.min(5, r.widthFt / 60));
    svg += `<line x1="${X(r.le)}" y1="${Y(r.le)}" x2="${X(r.he)}" y2="${Y(r.he)}" class="rwy-strip" stroke-width="${w}"/>`;
    for (const [end, other] of [[r.le, r.he], [r.he, r.le]]) {
      if (!end.id) continue;
      const hw = !calm && end.hdg != null ? headwind(wdir, wspd, end.hdg) : null;
      const inUse = hw != null && hw > 0;
      // label sits just beyond its own threshold, on the approach side
      const dx = X(end) - X(other), dy = Y(end) - Y(other);
      const len = Math.hypot(dx, dy) || 1;
      const lx = X(end) + (dx / len) * 11, ly = Y(end) + (dy / len) * 11;
      svg += `<text x="${lx}" y="${ly}" class="rwy-l${inUse ? ' use' : ''}">${end.id}</text>`;
      if (inUse)
        uses.push(
          `${end.id} (headwind ${hw.toFixed(0)} kt, xwind ${Math.abs(
            wspd * Math.sin(((wdir - end.hdg) * Math.PI) / 180),
          ).toFixed(0)} kt)`,
        );
    }
  }
  // wind arrow in the corner, flying downwind
  const windArrow = calm
    ? ''
    : `<g transform="translate(62,-62) rotate(${wdir})" class="rwy-wind"><line y1="-11" y2="9"/><path d="M0,14 L-4,5 L4,5 Z"/></g>`;
  return `
    <div style="color:var(--amber);margin:7px 0 3px">AIRPORT DIAGRAM — RUNWAYS IN USE</div>
    <svg viewBox="-80 -80 160 160" class="rwy-svg">${svg}${windArrow}</svg>
    <div class="note">${
      calm
        ? 'Winds calm/light — any runway plausible.'
        : uses.length
          ? 'Into-wind (plausible active): ' + uses.join(' · ')
          : 'No runway aligned with the wind — expect crosswind operations.'
    }</div>`;
}
