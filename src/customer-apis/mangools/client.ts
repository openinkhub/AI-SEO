// Mangools REST client (https://api.mangools.com/v3/). One request at a time per key, small gap between
// calls, and the documented 429 handling: RateLimit -> wait retry_after and resend; CreditLimit -> stop.
const BASE = 'https://api.mangools.com/v3/';

export class MangoolsError extends Error {
  constructor(message: string, readonly status?: number, readonly kind?: string) {
    super(message);
  }
}

const chains = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once(apiKey: string, path: string, params: Record<string, string | number>, timeoutMs: number): Promise<{ res: Response; body: any }> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => q.set(k, String(v)));
  const url = `${BASE}${path.replace(/^\//, '')}${q.toString() ? `?${q}` : ''}`;
  const res = await fetch(url, { headers: { 'x-access-token': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const body: any = await res.json().catch(() => ({}));
  return { res, body };
}

async function run(apiKey: string, path: string, params: Record<string, string | number>, timeoutMs: number): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { res, body } = await once(apiKey, path, params, timeoutMs);
    if (res.ok) return body;
    const err = body?.error ?? {};
    const msg = String(err.message ?? body?.message ?? `HTTP ${res.status}`);
    if (res.status === 429) {
      if (err.type === 'CreditLimit') throw new MangoolsError('Mangools plan quota is used up for this period.', 429, 'CreditLimit');
      if (err.type === 'RateLimit' || /rate/i.test(msg)) {
        const wait = Math.min(25, Number(err.retry_after ?? body?.retry_after ?? res.headers.get('retry-after') ?? 2) || 2);
        await sleep(wait * 1000 + 250);
        continue;
      }
      throw new MangoolsError(msg, 429, 'Limit');
    }
    if (res.status === 401 || res.status === 403) throw new MangoolsError('Mangools rejected the REST API key.', res.status, 'Auth');
    throw new MangoolsError(msg, res.status);
  }
  throw new MangoolsError('Mangools kept rate-limiting the request.', 429, 'RateLimit');
}

export function mangoolsGet(apiKey: string, path: string, params: Record<string, string | number> = {}, timeoutMs = 40000): Promise<any> {
  const prev = chains.get(apiKey) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    await sleep(350);
    return run(apiKey, path, params, timeoutMs);
  });
  chains.set(apiKey, next.catch(() => undefined));
  return next;
}
