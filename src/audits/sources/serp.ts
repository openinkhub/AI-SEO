// SerpApi Google search (https://serpapi.com/search.json). Used for related searches, People Also Ask,
// where the customer's domain ranks, and the local pack.
export interface SerpResult {
  query: string;
  related: string[];
  questions: string[];
  top: Array<{ pos: number; title: string; domain: string }>;
  ownPosition: number | null;
  places: Array<{ name: string; rating: number | null; reviews: number | null; address: string; own: boolean }>;
  hasAiOverview: boolean;
}

const host = (u: string): string => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
};

export async function serpSearch(apiKey: string, query: string, opts: { location?: string; gl?: string; hl?: string; ownDomain: string }): Promise<SerpResult> {
  const q = new URLSearchParams({ engine: 'google', q: query, num: '20', hl: opts.hl || 'en', gl: opts.gl || 'in', api_key: apiKey });
  if (opts.location) q.set('location', opts.location);
  const res = await fetch(`https://serpapi.com/search.json?${q}`, { signal: AbortSignal.timeout(45000) });
  const b: any = await res.json().catch(() => ({}));
  if (!res.ok || b.error) throw new Error(`SerpApi: ${b.error || `HTTP ${res.status}`}`);
  const own = host(opts.ownDomain);
  const organic: any[] = Array.isArray(b.organic_results) ? b.organic_results : [];
  const top = organic.slice(0, 10).map((o) => ({ pos: Number(o.position) || 0, title: String(o.title ?? '').slice(0, 100), domain: host(String(o.link ?? '')) }));
  const hit = organic.find((o) => host(String(o.link ?? '')) === own);
  const rawPlaces: any[] = Array.isArray(b.local_results?.places) ? b.local_results.places : Array.isArray(b.local_results) ? b.local_results : [];
  return {
    query,
    related: (Array.isArray(b.related_searches) ? b.related_searches : []).map((r: any) => String(r.query ?? '')).filter(Boolean).slice(0, 10),
    questions: (Array.isArray(b.related_questions) ? b.related_questions : []).map((r: any) => String(r.question ?? '')).filter(Boolean).slice(0, 8),
    top,
    ownPosition: hit ? Number(hit.position) || null : null,
    places: rawPlaces.slice(0, 6).map((p) => ({
      name: String(p.title ?? '').slice(0, 80),
      rating: p.rating != null ? Number(p.rating) : null,
      reviews: p.reviews != null ? Number(p.reviews) : null,
      address: String(p.address ?? '').slice(0, 100),
      own: !!(p.links?.website && host(String(p.links.website)) === own),
    })),
    hasAiOverview: !!b.ai_overview,
  };
}
