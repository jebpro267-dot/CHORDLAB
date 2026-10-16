import { backendFetch } from "./backend";

export interface CatalogChord {
  _id?: string;
  name?: { eng?: string; spa?: string };
  notes?: Array<{ name?: string | { eng?: string } } | string>;
  images?: { pos1?: string };
}

/**
 * Queries the backend chords API catalog for precomputed fingerings and chord diagrams.
 *
 * @param label - Standard chord label (e.g. 'C', 'Am', 'G7').
 * @returns Promise resolving to the CatalogChord metadata if available, or null if not found.
 */
export async function fetchCatalogChord(label: string): Promise<CatalogChord | null> {
  try {
    const response = await backendFetch(`/api/chords?label=${encodeURIComponent(label)}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; chord?: CatalogChord | null };
    return payload.ok ? (payload.chord ?? null) : null;
  } catch {
    return null;
  }
}
