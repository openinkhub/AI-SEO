// Ahrefs free Domain Rating API (API v3, /public/domain-rating-free). Free, but needs an API v3 key
// (Account settings > API keys). Data licence requires the credit "Domain Rating by Ahrefs".
const URL_ = 'https://api.ahrefs.com/v3/public/domain-rating-free';

const hostOf = (s: string): string => String(s).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase();

export interface DrResult {
  site: { domain: string; domainRating: number | null };
  competitors: Array<{ domain: string; domainRating: number | null }>;
  credit: string;
}

export async function ahrefsDomainRating(apiKey: string, domain: string, competitors: string[], timeoutMs = 30000): Promise<DrResult> {
  const own = hostOf(domain);
  const comps = [...new Set(competitors.map(hostOf).filter((c) => c && c !== own))];
  const res = await fetch(`${URL_}?output=json`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ targets: [own, ...comps] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const b: any = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('Ahrefs rejected the API key (create an API v3 key in Ahrefs Account settings > API keys).');
  if (res.status === 429) throw new Error('Ahrefs rate limit reached - try again shortly.');
  if (!res.ok) throw new Error(b?.error || b?.message || `Ahrefs HTTP ${res.status}`);
  const list: any[] = Array.isArray(b?.domain_rating?.targets) ? b.domain_rating.targets : [];
  const dr = (t: string): number | null => {
    const hit = list.find((x) => hostOf(String(x?.target ?? '')) === t);
    return hit && hit.domain_rating != null && isFinite(Number(hit.domain_rating)) ? Math.round(Number(hit.domain_rating) * 10) / 10 : null;
  };
  return { site: { domain: own, domainRating: dr(own) }, competitors: comps.map((c) => ({ domain: c, domainRating: dr(c) })), credit: 'Domain Rating by Ahrefs (https://ahrefs.com/)' };
}
