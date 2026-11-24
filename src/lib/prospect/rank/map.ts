// Web Mercator maths to draw the grid over OpenStreetMap tiles without a map library.

export const TILE = 256;

export interface MapView {
  zoom: number;
  size: number;
  tiles: { key: string; x: number; y: number; left: number; top: number }[];
  project(lat: number, lng: number): { x: number; y: number };
}

function worldPx(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** Highest zoom (max 17) at which `extentM` meters around the center fit in `size` pixels. */
export function fitZoom(lat: number, extentM: number, size: number): number {
  for (let z = 17; z >= 1; z--) {
    const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    if (extentM / mPerPx <= size) return z;
  }
  return 1;
}

export function buildView(
  lat: number,
  lng: number,
  extentM: number,
  size: number
): MapView {
  const zoom = fitZoom(lat, extentM, size);
  const c = worldPx(lat, lng, zoom);
  const originX = c.x - size / 2;
  const originY = c.y - size / 2;
  const n = 2 ** zoom;
  const tiles: MapView['tiles'] = [];
  for (
    let ty = Math.floor(originY / TILE);
    ty <= Math.floor((originY + size) / TILE);
    ty++
  ) {
    for (
      let tx = Math.floor(originX / TILE);
      tx <= Math.floor((originX + size) / TILE);
      tx++
    ) {
      if (ty < 0 || ty >= n) continue;
      const x = ((tx % n) + n) % n;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        x,
        y: ty,
        left: tx * TILE - originX,
        top: ty * TILE - originY,
      });
    }
  }
  return {
    zoom,
    size,
    tiles,
    project(la, ln) {
      const p = worldPx(la, ln, zoom);
      return { x: p.x - originX, y: p.y - originY };
    },
  };
}
