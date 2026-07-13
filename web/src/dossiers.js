import { hexCountry, mmsiCountry, NAT_OPTIONS } from './contactFilters.js';

// Dossier builder (Theme 1 capstone).
//
// A living per-nation dossier that accrues automatically from attributable
// alerts: a dark ship flagged to Iran, a Russian military jet squawking
// emergency, a Chinese-flagged vessel in an STS transfer, a surveillance orbit
// by a US aircraft. Each alert carries a contact ref (icao/mmsi); we resolve it
// to a flag state and append a timestamped entry. Entries age out after two
// weeks. The result is a queryable, evolving picture per nation that also feeds
// an on-demand LLM brief.

const KEY = 'sentinel.dossiers';
const MAX_EVENTS = 80; // per nation
const MAX_AGE_MS = 14 * 864e5; // 14 days
const MAX_NATIONS = 60;

export class Dossiers {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.map = new Map(); // code -> { code, name, events:[{t,type,summary,lat,lon}], firstSeen, lastSeen }
    this._load();
  }

  // Resolve an alert's contact ref to a flag-state country code.
  _nation(ref) {
    if (!ref) return null;
    let c = ref.icao ? hexCountry(ref.icao) : ref.mmsi != null ? mmsiCountry(ref.mmsi) : null;
    if (!c) return null;
    return c === 'US-MIL' ? 'US' : c;
  }

  // Fold an alert record ({title,msg,lat,lon,ref,t}) into the owning nation's file.
  ingestAlert(rec) {
    const code = this._nation(rec.ref);
    if (!code) return; // unattributable (quake, launch, …) — not nation-specific
    const now = rec.t || Date.now();
    let d = this.map.get(code);
    if (!d) {
      d = { code, name: NAT_OPTIONS[code] || code, events: [], firstSeen: now, lastSeen: now };
      this.map.set(code, d);
    }
    d.events.unshift({ t: now, type: rec.title, summary: rec.msg, lat: rec.lat, lon: rec.lon });
    if (d.events.length > MAX_EVENTS) d.events.length = MAX_EVENTS;
    d.lastSeen = now;
    this._prune();
    this._save();
    this.onChange();
  }

  _prune() {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [code, d] of this.map) {
      d.events = d.events.filter((e) => e.t >= cutoff);
      if (!d.events.length) this.map.delete(code);
    }
    if (this.map.size > MAX_NATIONS) {
      const keep = [...this.map.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_NATIONS);
      this.map = new Map(keep.map((d) => [d.code, d]));
    }
  }

  list() {
    return [...this.map.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }
  get(code) {
    return this.map.get(code);
  }
  clear(code) {
    this.map.delete(code);
    this._save();
    this.onChange();
  }

  // Prompt for the on-demand LLM dossier brief.
  briefPrompt(code) {
    const d = this.map.get(code);
    if (!d) return '';
    const lines = d.events
      .slice(0, 45)
      .map(
        (e) =>
          `- ${new Date(e.t).toISOString().slice(0, 16).replace('T', ' ')}Z  ${e.type}: ${e.summary}`,
      )
      .join('\n');
    return (
      `You are an OSINT intelligence analyst. Write a concise dossier brief on ${d.name} ` +
      `based ONLY on these events observed by the ARGUS geospatial feed over the last two weeks. ` +
      `Three sections: SUMMARY, NOTABLE ACTIVITY, ASSESSMENT. Be factual and terse; do not invent ` +
      `data beyond what the events state.\n\nOBSERVED EVENTS (${d.events.length}):\n${lines}`
    );
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.map.values()]));
    } catch (_) {}
  }
  _load() {
    try {
      for (const d of JSON.parse(localStorage.getItem(KEY) || '[]')) this.map.set(d.code, d);
      this._prune();
    } catch (_) {
      this.map = new Map();
    }
  }
}
