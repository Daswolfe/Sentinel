// Contact filtering: nationality, military/civilian, notable watchlist.
// Applies to the moving-contact layers (AIR, SEA, DARK). Resolution is
// heuristic but standard OSINT practice:
//   • vessels    → flag state from the MMSI's first 3 digits (ITU MID)
//   • aircraft   → registration country from the ICAO24 hex allocation block
//   • military   → AIS ship type 35, naval name prefixes; military hex blocks
//                  and well-known military callsign prefixes for aircraft
//   • notable    → editable watchlist matched against name/callsign/hex/MMSI

// ITU Maritime Identification Digits → country (majors + big flag states).
const MID = {
  201: 'AL', 203: 'AT', 205: 'BE', 209: 'CY', 210: 'CY', 211: 'DE', 212: 'CY',
  215: 'MT', 218: 'DE', 219: 'DK', 220: 'DK', 224: 'ES', 225: 'ES', 226: 'FR',
  227: 'FR', 228: 'FR', 229: 'MT', 230: 'FI', 231: 'FO', 232: 'GB', 233: 'GB',
  234: 'GB', 235: 'GB', 236: 'GI', 237: 'GR', 238: 'HR', 239: 'GR', 240: 'GR',
  241: 'GR', 242: 'MA', 243: 'HU', 244: 'NL', 245: 'NL', 246: 'NL', 247: 'IT',
  248: 'MT', 249: 'MT', 250: 'IE', 251: 'IS', 252: 'LI', 253: 'LU', 255: 'PT',
  256: 'MT', 257: 'NO', 258: 'NO', 259: 'NO', 261: 'PL', 262: 'ME', 263: 'PT',
  264: 'RO', 265: 'SE', 266: 'SE', 267: 'SK', 268: 'SM', 269: 'CH', 270: 'CZ',
  271: 'TR', 272: 'UA', 273: 'RU', 274: 'MK', 275: 'LV', 276: 'EE', 277: 'LT',
  278: 'SI', 279: 'RS', 301: 'AI', 303: 'US', 304: 'AG', 305: 'AG', 306: 'CW',
  308: 'BS', 309: 'BS', 310: 'BM', 311: 'BS', 312: 'BZ', 314: 'BB', 316: 'CA',
  319: 'KY', 321: 'CR', 323: 'CU', 325: 'DM', 327: 'DO', 329: 'GP', 330: 'GD',
  331: 'GL', 332: 'GT', 334: 'HN', 336: 'HT', 338: 'US', 339: 'JM', 341: 'KN',
  343: 'LC', 345: 'MX', 347: 'MQ', 348: 'MS', 350: 'NI', 351: 'PA', 352: 'PA',
  353: 'PA', 354: 'PA', 355: 'PA', 356: 'PA', 357: 'PA', 358: 'PR', 359: 'SV',
  361: 'PM', 362: 'TT', 364: 'TC', 366: 'US', 367: 'US', 368: 'US', 369: 'US',
  370: 'PA', 371: 'PA', 372: 'PA', 373: 'PA', 374: 'PA', 375: 'VC', 376: 'VC',
  377: 'VC', 378: 'VG', 379: 'VI', 401: 'AF', 403: 'SA', 405: 'BD', 408: 'BH',
  410: 'BT', 412: 'CN', 413: 'CN', 414: 'CN', 416: 'TW', 417: 'LK', 419: 'IN',
  422: 'IR', 423: 'AZ', 425: 'IQ', 428: 'IL', 431: 'JP', 432: 'JP', 434: 'TM',
  436: 'KZ', 437: 'UZ', 438: 'JO', 440: 'KR', 441: 'KR', 443: 'PS', 445: 'KP',
  447: 'KW', 450: 'LB', 451: 'KG', 453: 'MO', 455: 'MV', 457: 'MN', 459: 'NP',
  461: 'OM', 463: 'PK', 466: 'QA', 468: 'SY', 470: 'AE', 471: 'AE', 472: 'TJ',
  473: 'YE', 475: 'YE', 477: 'HK', 478: 'BA', 501: 'FR', 503: 'AU', 506: 'MM',
  508: 'BN', 510: 'FM', 511: 'PW', 512: 'NZ', 514: 'KH', 515: 'KH', 516: 'CX',
  518: 'CK', 520: 'FJ', 523: 'CC', 525: 'ID', 529: 'KI', 531: 'LA', 533: 'MY',
  536: 'MP', 538: 'MH', 540: 'NC', 542: 'NU', 544: 'NR', 546: 'PF', 548: 'PH',
  550: 'TL', 553: 'PG', 555: 'PN', 557: 'SB', 559: 'AS', 561: 'WS', 563: 'SG',
  564: 'SG', 565: 'SG', 566: 'SG', 567: 'TH', 570: 'TO', 572: 'TV', 574: 'VN',
  576: 'VU', 577: 'VU', 578: 'WF', 601: 'ZA', 603: 'AO', 605: 'DZ', 607: 'TF',
  608: 'SH', 609: 'BI', 610: 'BJ', 611: 'BW', 612: 'CF', 613: 'CM', 615: 'CG',
  616: 'KM', 617: 'CV', 618: 'AQ', 619: 'CI', 620: 'KM', 621: 'DJ', 622: 'EG',
  624: 'ET', 625: 'ER', 626: 'GA', 627: 'GH', 629: 'GM', 630: 'GW', 631: 'GQ',
  632: 'GN', 633: 'BF', 634: 'KE', 635: 'AQ', 636: 'LR', 637: 'LR', 638: 'SS',
  642: 'LY', 644: 'LS', 645: 'MU', 647: 'MG', 649: 'ML', 650: 'MZ', 654: 'MR',
  655: 'MW', 656: 'NE', 657: 'NG', 659: 'NA', 660: 'RE', 661: 'RW', 662: 'SD',
  663: 'SN', 664: 'SC', 665: 'SH', 666: 'SO', 667: 'SL', 668: 'ST', 669: 'SZ',
  670: 'TD', 671: 'TG', 672: 'TN', 674: 'TZ', 675: 'UG', 676: 'CD', 677: 'TZ',
  678: 'ZM', 679: 'ZW',
};

// ICAO24 hex allocation blocks (majors). [start, end, country]
const HEX_BLOCKS = [
  [0x008000, 0x00ffff, 'ZA'], [0x0a0000, 0x0a7fff, 'DZ'], [0x100000, 0x1fffff, 'RU'],
  [0x201000, 0x2013ff, 'MA'], [0x300000, 0x33ffff, 'IT'], [0x340000, 0x37ffff, 'ES'],
  [0x380000, 0x3bffff, 'FR'], [0x3c0000, 0x3fffff, 'DE'], [0x400000, 0x43ffff, 'GB'],
  [0x440000, 0x447fff, 'AT'], [0x448000, 0x44ffff, 'BE'], [0x450000, 0x457fff, 'BG'],
  [0x458000, 0x45ffff, 'DK'], [0x460000, 0x467fff, 'FI'], [0x468000, 0x46ffff, 'GR'],
  [0x470000, 0x477fff, 'HU'], [0x478000, 0x47ffff, 'NO'], [0x480000, 0x487fff, 'NL'],
  [0x488000, 0x48ffff, 'PL'], [0x490000, 0x497fff, 'PT'], [0x498000, 0x49ffff, 'CZ'],
  [0x4a0000, 0x4a7fff, 'RO'], [0x4a8000, 0x4affff, 'SE'], [0x4b0000, 0x4b7fff, 'CH'],
  [0x4b8000, 0x4bffff, 'TR'], [0x4ca000, 0x4cafff, 'IE'], [0x500000, 0x5003ff, 'SM'],
  [0x508000, 0x50ffff, 'UA'], [0x700000, 0x700fff, 'AF'], [0x702000, 0x702fff, 'BD'],
  [0x718000, 0x71ffff, 'KR'], [0x720000, 0x727fff, 'KP'], [0x730000, 0x737fff, 'IR'],
  [0x738000, 0x73ffff, 'IL'], [0x740000, 0x747fff, 'JO'], [0x748000, 0x74ffff, 'LB'],
  [0x750000, 0x757fff, 'MY'], [0x758000, 0x75ffff, 'PH'], [0x760000, 0x767fff, 'PK'],
  [0x768000, 0x76ffff, 'SG'], [0x770000, 0x777fff, 'LK'], [0x778000, 0x77ffff, 'SY'],
  [0x780000, 0x7bffff, 'CN'], [0x7c0000, 0x7fffff, 'AU'], [0x800000, 0x83ffff, 'IN'],
  [0x840000, 0x87ffff, 'JP'], [0x880000, 0x887fff, 'TH'], [0x888000, 0x88ffff, 'VN'],
  [0x890000, 0x890fff, 'YE'], [0x894000, 0x894fff, 'AE'], [0x896000, 0x896fff, 'QA'],
  [0x897000, 0x8973ff, 'BH'], [0x899000, 0x8993ff, 'TW'], [0x8a0000, 0x8a7fff, 'ID'],
  [0xa00000, 0xadffff, 'US'], [0xae0000, 0xafffff, 'US-MIL'], [0xc00000, 0xc3ffff, 'CA'],
  [0xc80000, 0xc87fff, 'NZ'], [0xe00000, 0xe3ffff, 'AR'], [0xe40000, 0xe7ffff, 'BR'],
  [0xe80000, 0xe80fff, 'CL'], [0xe84000, 0xe84fff, 'EC'], [0xe94000, 0xe94fff, 'PE'],
  [0x0d0000, 0x0d7fff, 'MX'], [0x710000, 0x717fff, 'SA'], [0x010000, 0x017fff, 'EG'],
];

// Military callsign prefixes (aircraft) — common, not exhaustive.
const MIL_CALLSIGNS = [
  'RCH', 'REACH', 'SAM', 'AF1', 'AF2', 'VENUS', 'ORDER', 'SPAR', 'PAT', 'DUKE',
  'KING', 'HKY', 'HERKY', 'CNV', 'NAVY', 'RRR', 'ASCOT', 'CFC', 'GAF', 'FAF',
  'IAM', 'AME', 'PLF', 'HOBO', 'MC', 'ROF', 'BAF', 'NOW', 'LAGR', 'QID',
  'TOPCAT', 'DRAGN', 'SNTRY', 'JAKE', 'DOOM', 'PYTHON', 'HAWG', 'TREK',
];

// Default notable watchlist — editable in the UI, persisted to localStorage.
export const DEFAULT_WATCHLIST = [
  'AF1', 'AF2', 'SAM', 'VENUS',      // US executive fleet callsigns
  'RRR', 'ASCOT', 'KITTY',           // RAF / royal flights
  'USS ', 'CVN', 'LHA', 'DDG',       // US naval name prefixes
  'ADMIRAL', 'PYOTR', 'KUZNETSOV',   // RU navy notables
  'LIAONING', 'SHANDONG', 'FUJIAN',  // CN carriers
  'QUEEN MARY', 'EVER ',             // notable civilians
];

export function hexCountry(icao24) {
  const n = parseInt(icao24, 16);
  if (!isFinite(n)) return null;
  for (const [a, b, c] of HEX_BLOCKS) if (n >= a && n <= b) return c;
  return null;
}

export function mmsiCountry(mmsi) {
  return MID[String(mmsi).slice(0, 3)] ?? null;
}

function isMilitary(m) {
  if (m.layer === 'MILAIR') return true; // the whole feed is military
  if (m.layer === 'AIR') {
    if (hexCountry(m.icao) === 'US-MIL') return true;
    const cs = (m.callsign || '').toUpperCase();
    return MIL_CALLSIGNS.some((p) => cs.startsWith(p));
  }
  // AIS ship type 35 = military ops; plus naval name prefixes. m.shipType is
  // the fast numeric field; the rows lookup is a legacy fallback only.
  const t = String(m.shipType ?? m.rows?.['SHIP TYPE'] ?? '');
  if (t === '35') return true;
  const name = (m.headline || '').toUpperCase();
  return /^(USS |USNS |HMS |RFS |FGS |FS |ITS |JS |ROKS |PLANS |TCG |INS )/.test(name);
}

function isNotable(m, watchlist) {
  const hay = `${m.headline ?? ''} ${m.callsign ?? ''} ${m.icao ?? ''} ${m.mmsi ?? ''}`.toUpperCase();
  return watchlist.some((w) => w && hay.includes(w.toUpperCase()));
}

const WL_KEY = 'sentinel.watchlist';

// The active filter state, mutated by the UI.
export const FILTER = {
  nat: '',
  mil: 'all',
  watchOnly: false,
  movingOnly: false, // hide anchored vessels / near-stationary targets
  altBand: 'all',    // aircraft: all | lo (<10k ft) | mid (10–30k) | hi (>30k)
  orbitBand: 'all',  // satellites: all | leo | meo | geo
  watchlist: loadWatchlist(),
};

function loadWatchlist() {
  try {
    const s = JSON.parse(localStorage.getItem(WL_KEY));
    if (Array.isArray(s)) return s;
  } catch (_) {}
  return [...DEFAULT_WATCHLIST];
}
export function saveWatchlist() {
  try { localStorage.setItem(WL_KEY, JSON.stringify(FILTER.watchlist)); } catch (_) {}
}
export function addToWatchlist(term) {
  term = (term || '').trim();
  if (!term) return false;
  const up = term.toUpperCase();
  if (FILTER.watchlist.some((w) => w.toUpperCase() === up)) return false;
  FILTER.watchlist.push(term);
  saveWatchlist();
  return true;
}
export function removeFromWatchlist(term) {
  FILTER.watchlist = FILTER.watchlist.filter((w) => w !== term);
  saveWatchlist();
}
export const matchesWatchlist = (m) => isNotable(m, FILTER.watchlist);
// The token to add when the user watches a picked contact — prefer a meaningful
// callsign / vessel name, fall back to the hard id (hex / MMSI).
export function watchlistTerm(m) {
  if (!m) return '';
  if (m.callsign && m.callsign.trim()) return m.callsign.trim();
  if (m.icao) return String(m.icao).toUpperCase();
  const name = (m.headline || '').replace(/^⚠ DARK — /, '').trim();
  if (name && !/^MMSI\b/i.test(name)) return name;
  return m.mmsi != null ? String(m.mmsi) : name;
}

const AIRBORNE = new Set(['AIR', 'MILAIR']);
const CONTACT_LAYERS = new Set(['AIR', 'MILAIR', 'SEA', 'DARK']);

// Predicate handed to the LayerContext; true = keep the contact visible.
export function contactPasses(m, layerId) {
  // Satellites only respond to the orbit-band cut.
  if (layerId === 'SAT') {
    if (FILTER.orbitBand === 'all') return true;
    const a = m.altKm ?? 0;
    if (FILTER.orbitBand === 'leo') return a < 2000;
    if (FILTER.orbitBand === 'meo') return a >= 2000 && a < 35000;
    return a >= 35000; // geo (+ graveyard)
  }
  if (!CONTACT_LAYERS.has(layerId)) return true;
  if (FILTER.nat) {
    const c = AIRBORNE.has(layerId) ? hexCountry(m.icao) : mmsiCountry(m.mmsi);
    if ((c === 'US-MIL' ? 'US' : c) !== FILTER.nat) return false;
  }
  if (FILTER.mil !== 'all') {
    const mil = isMilitary(m);
    if (FILTER.mil === 'mil' && !mil) return false;
    if (FILTER.mil === 'civ' && mil) return false;
  }
  // Underway-only: anchored/moored AIS targets are half the maritime plot.
  // Unknown speed (null) is kept — absence of data isn't evidence of anchoring.
  if (FILTER.movingOnly) {
    const kt = m.ktGs ?? m.sog;
    if (kt != null && kt < (AIRBORNE.has(layerId) ? 30 : 0.5)) return false;
  }
  if (FILTER.altBand !== 'all' && AIRBORNE.has(layerId)) {
    const ft = m.altFt;
    if (ft != null) {
      if (FILTER.altBand === 'lo' && ft >= 10000) return false;
      if (FILTER.altBand === 'mid' && (ft < 10000 || ft > 30000)) return false;
      if (FILTER.altBand === 'hi' && ft <= 30000) return false;
    }
  }
  if (FILTER.watchOnly && !isNotable(m, FILTER.watchlist)) return false;
  return true;
}

// Countries offered in the NAT dropdown (code → label).
export const NAT_OPTIONS = {
  US: 'USA', RU: 'RUSSIA', CN: 'CHINA', GB: 'UK', DE: 'GERMANY', FR: 'FRANCE',
  IR: 'IRAN', KP: 'N.KOREA', KR: 'S.KOREA', IL: 'ISRAEL', TR: 'TÜRKIYE',
  UA: 'UKRAINE', IN: 'INDIA', PK: 'PAKISTAN', JP: 'JAPAN', TW: 'TAIWAN',
  SA: 'SAUDI', AE: 'UAE', QA: 'QATAR', EG: 'EGYPT', GR: 'GREECE', IT: 'ITALY',
  ES: 'SPAIN', NL: 'NETHERL.', NO: 'NORWAY', PA: 'PANAMA', LR: 'LIBERIA',
  MH: 'MARSHALL', MT: 'MALTA', SG: 'SINGAPORE', HK: 'HONG KONG', BS: 'BAHAMAS',
  CY: 'CYPRUS', DK: 'DENMARK', SE: 'SWEDEN', PL: 'POLAND', CA: 'CANADA',
  AU: 'AUSTRALIA', BR: 'BRAZIL', MX: 'MEXICO',
};
