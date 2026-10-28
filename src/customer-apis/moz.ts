// Moz Links API v2 (https://lsapi.seomoz.com/v2/url_metrics). Auth: x-moz-token header (API token) or Basic (Access ID + Secret Key).
const URL_ = 'https://lsapi.seomoz.com/v2/url_metrics';

const hostOf = (s: string): string => String(s).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase();
const num = (v: unknown): number | null => (v != null && v !== '' && isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);

export interface MozRow {
  domain: string;
  domainAuthority: number | null;
  pageAuthority: number | null;
  spamScore: number | null;
  linkingDomains: number | null;
  links: number | null;
}
export interface MozResult {
  site: MozRow;
  competitors: MozRow[];
}

export interface MozAuth {
  apiToken?: string;
  accessId?: string;
  secretKey?: string;
}

export async function mozUrlMetrics(auth: MozAuth, domains: string[], timeoutMs = 30000): Promise<MozRow[]> {
  const hosts = [...new Set(domains.map(hostOf).filter(Boolean))].slice(0, 25);
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      ...(auth.apiToken ? { 'x-moz-token': auth.apiToken } : { Authorization: `Basic ${Buffer.from(`${auth.accessId ?? ''}:${auth.secretKey ?? ''}`).toString('base64')}` }),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ targets: hosts.map((h) => `https://${h}/`) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const b: any = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('Moz rejected the credentials (check the API token, or Access ID + Secret Key).');
  if (res.status === 429) throw new Error('Moz rate limit reached - try again shortly.');
  if (!res.ok) throw new Error(b?.message || b?.error || `Moz HTTP ${res.status}`);
  const results: any[] = Array.isArray(b?.results) ? b.results : [];
  return hosts.map((h, i) => {
    const r = results[i] ?? {};
    return {
      domain: h,
      domainAuthority: num(r.domain_authority),
      pageAuthority: num(r.page_authority),
      spamScore: num(r.spam_score),
      linkingDomains: num(r.root_domains_to_root_domain),
      links: num(r.external_pages_to_root_domain ?? r.pages_to_root_domain ?? r.unique_links),
    };
  });
}

export async function mozAuthority(auth: MozAuth, domain: string, competitors: string[]): Promise<MozResult> {
  const own = hostOf(domain);
  const comps = [...new Set(competitors.map(hostOf).filter((c) => c && c !== own))];
  const rows = await mozUrlMetrics(auth, [own, ...comps]);
  return { site: rows[0], competitors: rows.slice(1) };
}
