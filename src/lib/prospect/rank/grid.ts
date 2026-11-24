// Geometry of a ranking scan: a square grid of points around a center.

export const GRID_SIZES = [3, 5, 7, 9] as const;
export const SPACINGS_M = [250, 500, 1000, 2000, 3000, 5000] as const;

export interface GridPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
}

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * `size` x `size` points, `spacingM` meters apart, centered on the given
 * coordinates. Row 0 is the northernmost row and column 0 the westernmost, so
 * the list reads like a map. The grid is square, which is accurate enough for
 * neighborhoods and cities (a few tens of km).
 */
export function buildGrid(
  centerLat: number,
  centerLng: number,
  size: number,
  spacingM: number
): GridPoint[] {
  const half = (size - 1) / 2;
  const dLat = spacingM / METERS_PER_DEGREE_LAT;
  const dLng =
    spacingM / (METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180));
  const points: GridPoint[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      points.push({
        row,
        col,
        lat: round6(centerLat + (half - row) * dLat),
        lng: round6(centerLng + (col - half) * dLng),
      });
    }
  }
  return points;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Distance in meters between two coordinates. */
export function distanceM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
