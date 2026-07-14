// Global display units (Theme 4.15). Internally every quantity has ONE
// canonical unit — aircraft altitude ft, speed kt, distance nm, temperature
// °C, coordinates decimal degrees — and these helpers convert at DISPLAY
// time. Preferences persist to localStorage; because detail rows are built
// when a feed ingests, a change applies as each layer next refreshes.

const KEY = 'sentinel.units';

export const UNITS = {
  alt: 'ft',   // ft | m | fl
  speed: 'kt', // kt | kmh | mph
  dist: 'nm',  // nm | km | mi
  temp: 'C',   // C | F
  coord: 'dd', // dd | dms
};
try {
  Object.assign(UNITS, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (_) {}

export function setUnit(k, v) {
  UNITS[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(UNITS)); } catch (_) {}
}

export function fmtAlt(ft) {
  if (ft == null || !isFinite(ft)) return '—';
  if (UNITS.alt === 'm') return Math.round(ft * 0.3048).toLocaleString() + ' m';
  if (UNITS.alt === 'fl') return 'FL' + String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');
  return Math.round(ft).toLocaleString() + ' ft';
}

export function fmtSpeed(kt) {
  if (kt == null || !isFinite(kt)) return '—';
  if (UNITS.speed === 'kmh') return (kt * 1.852).toFixed(0) + ' km/h';
  if (UNITS.speed === 'mph') return (kt * 1.15078).toFixed(0) + ' mph';
  return kt.toFixed(kt < 10 ? 1 : 0) + ' kt';
}

export function fmtDist(nm) {
  if (nm == null || !isFinite(nm)) return '—';
  if (UNITS.dist === 'km') return (nm * 1.852).toFixed(1) + ' km';
  if (UNITS.dist === 'mi') return (nm * 1.15078).toFixed(1) + ' mi';
  return nm.toFixed(1) + ' nm';
}

export function fmtTemp(c) {
  if (c == null || !isFinite(c)) return '—';
  if (UNITS.temp === 'F') return ((c * 9) / 5 + 32).toFixed(1) + ' °F';
  return (+c).toFixed(1) + ' °C';
}

function dms(v, pos, neg) {
  const h = v >= 0 ? pos : neg;
  v = Math.abs(v);
  const d = Math.floor(v);
  const mF = (v - d) * 60;
  const m = Math.floor(mF);
  const s = Math.round((mF - m) * 60);
  return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${h}`;
}

export const fmtLat = (v) =>
  v == null ? '—' : UNITS.coord === 'dms' ? dms(v, 'N', 'S') : v.toFixed(3) + '°';
export const fmtLon = (v) =>
  v == null ? '—' : UNITS.coord === 'dms' ? dms(v, 'E', 'W') : v.toFixed(3) + '°';
