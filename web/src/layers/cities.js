import { CONFIG } from '../config.js';
import { textSprite } from '../labels.js';

// Cities — Natural Earth populated places, toggleable cartography layer
// (default off to keep the plot clean). Points for the top CONFIG.CITIES.max
// by population; name labels for the biggest CONFIG.CITIES.labelTop. Roads
// aren't drawn as vectors — the deep-zoom Esri imagery already carries them.

export default {
  id: 'CITY',
  name: 'Cities',
  color: 0xc8d6e0,
  css: '#c8d6e0',
  size: 2.6,
  defaultOff: true,

  init(ctx) {
    this.lblGrp = new ctx.THREE.Group();
    this.lblGrp.visible = false; // follows the layer toggle
    ctx.scene.add(this.lblGrp);
  },

  onVisible(on) {
    if (this.lblGrp) this.lblGrp.visible = on;
  },

  async load(ctx) {
    ctx.ui.status('CITY', 'wait');
    try {
      const gj = await (await fetch(CONFIG.CITIES.url)).json();
      const feats = (gj.features || [])
        .filter((f) => f.geometry?.coordinates && (f.properties?.pop_max ?? 0) > 0)
        .sort((a, b) => (b.properties.pop_max ?? 0) - (a.properties.pop_max ?? 0))
        .slice(0, CONFIG.CITIES.max);
      const pos = new Float32Array(feats.length * 3);
      const meta = [];
      feats.forEach((f, i) => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties;
        const v = ctx.llToV(lat, lon, ctx.R + 0.035);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        if (i < CONFIG.CITIES.labelTop) {
          const sp = textSprite(p.name, 0.75, '#8fa8ba', 0.75);
          sp.position.copy(ctx.llToV(lat, lon, ctx.R + 0.3));
          sp.userData.base = sp.scale.clone(); // render loop scales from this with zoom
          this.lblGrp.add(sp);
        }
        meta.push({
          layer: 'CITY',
          lat,
          lon,
          headline: `${p.name} — ${p.adm0name ?? ''}`,
          rows: {
            TYPE: 'CITY',
            COUNTRY: p.adm0name ?? '—',
            POPULATION: (p.pop_max ?? 0).toLocaleString(),
            CAPITAL: p.featurecla?.includes('capital') ? 'yes' : '—',
            LAT: lat.toFixed(2) + '°',
            LON: lon.toFixed(2) + '°',
            SOURCE: 'Natural Earth',
          },
        });
      });
      ctx.setLayerData('CITY', pos, meta);
      ctx.ui.status('CITY', 'ok');
    } catch (e) {
      ctx.ui.status('CITY', 'err');
    }
  },
};
