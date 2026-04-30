// Catalogue fetcher with a 5-minute in-process TTL and a build-time
// bundled fallback. See ADR-0019 §4 for the data-source decision.
//
// Two modes:
//   1. Runtime fetch from the canonical Pages endpoint with a TTL cache
//      so the agent always sees a catalogue recent enough to reflect a
//      same-day recipe addition.
//   2. Bundled snapshot fallback for offline use, network failure, or
//      cold start before the first successful fetch.
//
// The bundled snapshot is shipped in src/bundled/recipes.json — it is
// refreshed at publish time by the GHA workflow that copies the latest
// docs/public/api/recipes.json into the package before publish.

import type { RecipesIndex, VerdictSnapshot } from './types.js';
import bundledIndex from './bundled/recipes.json' with { type: 'json' };

export const INDEX_URL =
  'https://aletheia-works.github.io/vivarium/api/recipes.json';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  index: RecipesIndex;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

// Reset cache; only used by tests.
export function _resetCacheForTesting(): void {
  cache = null;
}

export function getBundledIndex(): RecipesIndex {
  return bundledIndex as unknown as RecipesIndex;
}

export async function getCatalogue(): Promise<RecipesIndex> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return cache.index;
  }

  try {
    const res = await fetch(INDEX_URL, {
      headers: { 'accept': 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as RecipesIndex;
      if (data && data.index === 'v1' && Array.isArray(data.recipes)) {
        cache = { index: data, fetchedAt: now };
        return data;
      }
    }
  } catch {
    // Network failure → fall through to bundled fallback.
  }

  return getBundledIndex();
}

export async function fetchVerdictSnapshot(
  verdictUrl: string,
): Promise<VerdictSnapshot | null> {
  try {
    const res = await fetch(verdictUrl, {
      headers: { 'accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VerdictSnapshot;
    if (data && data.contract === 'v1') return data;
    return null;
  } catch {
    return null;
  }
}
