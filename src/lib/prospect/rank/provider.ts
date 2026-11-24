// How a position is measured at one point of the grid.

export interface RankTarget {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RankQuery {
  keyword: string;
  lat: number;
  lng: number;
  /** Radius (m) of the area the search is biased towards. */
  radiusM: number;
  target: RankTarget;
}

export interface RankHit {
  /** Position of the target among the results (1 = first), or null when it did not appear. */
  rank: number | null;
  /** The first results, best first. Names are present only when the provider was asked for them. */
  top: { id: string; name?: string }[];
  /** Billable requests used. */
  requests: number;
}

export interface RankProvider {
  id: 'google' | 'dataforseo' | 'mock';
  rankAt(query: RankQuery): Promise<RankHit>;
}
