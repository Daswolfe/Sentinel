import * as THREE from 'three';

// Billboarded text sprites for map labels (nation names, city names).
// Rasterized once per string; tinted at draw time is not possible for canvas
// text, so colour is baked — pass it in.
export function textSprite(text, size = 1, color = '#9fb6c8', opacity = 0.85) {
  const measure = document.createElement('canvas').getContext('2d');
  const font = '600 30px Rajdhani, sans-serif';
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 10;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = 40;
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 5, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false }),
  );
  sp.scale.set((w / 40) * 2.6 * size, 2.6 * size, 1);
  return sp;
}
