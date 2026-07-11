import * as THREE from 'three';

// Globe radius in scene units. All layers share this so altitudes and
// surface points line up. Keep it here as the single source of truth.
export const GLOBE_R = 100;

// Convert geodetic lat/lon (degrees) + radius to a 3D position on/above the globe.
// Longitude convention matches the coastline basemap and graticule.
export function llToV(lat, lon, r = GLOBE_R) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const th = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(th),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(th),
  );
}
