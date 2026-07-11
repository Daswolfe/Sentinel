// Stub layers — registered so they appear in the sidebar with their status dot,
// but not yet wired to a data source. Each has a documented path to going live.
// Implement by fetching real data and calling ctx.setLayerData(id, pos, meta).

export const OUTAGE = {
  id: 'OUTAGE',
  name: 'Power Outages',
  color: 0x7f8fa6,
  css: '#7f8fa6',
  disabled: true,
  tag: 'STUB',
  // PowerOutage.us (paid) or EIA-930 grid data. Return [{lat,lon,customersOut,region}].
  load(ctx) {
    ctx.ui.status('OUTAGE', 'off');
  },
};

export const INTERNET = {
  id: 'INTERNET',
  name: 'Net Outages',
  color: 0x9aa7b4,
  css: '#9aa7b4',
  disabled: true,
  tag: 'STUB',
  // IODA API or Cloudflare Radar (token + proxy for CORS). Return [{lat,lon,region,score}].
  load(ctx) {
    ctx.ui.status('INTERNET', 'off');
  },
};

export const SOCINT = {
  id: 'SOCINT',
  name: 'Social Media',
  color: 0x5d7182,
  css: '#5d7182',
  disabled: true,
  tag: 'STUB',
  // X API v2 recent search via the backend proxy (browsers can't call X directly).
  // Geotag results → setLayerData('SOCINT', …); render media in the SOCINT panel.
  load(ctx) {
    ctx.ui.status('SOCINT', 'off');
  },
};

export default [OUTAGE, INTERNET, SOCINT];
