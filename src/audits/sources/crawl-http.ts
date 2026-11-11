
// HTTP helpers for the site crawl: a public-host guard (no private / loopback addresses), manual redirect
// following (so every hop is counted and re-checked), and a small robots.txt reader.
import { lookup } from 'dns/promises';
import { isIP } from 'net';

export const CRAWL_UA = 'Mozilla/5.0 (compatible; OpeninkHubAudit/2.0; +https://openinkhub.io)';
const MAX_BODY = 1_500_000;
const MAX_HOPS = 6;

export const withProto = (w: string): string => (/^https?:\/\//i.test(w) ? w : `https://${w}`).replace(/\/+$/, '');
export const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const hostCache = new Map<string, boolean>();
// True when the host resolves only to public addresses. CRAWL_ALLOW_PRIVATE=1 turns the guard off (local tests only).
export async function isPublicHost(host: string): Promise<boolean> {
  if (process.env.CRAWL_ALLOW_PRIVATE === '1') return true;
  const h = host.toLowerCase();
  if (hostCache.has(h)) return hostCache.get(h) as boolean;
  let ok = false;
  try {
    if (isIP(h)) ok = !privateIp(h);
    else if (/^(localhost|.*\.local|.*\.internal)$/.test(h)) ok = false;
    else {
      const addrs = await lookup(h, { all: true });
      ok = addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
    }
  } catch {
    ok = false;
  }
  hostCache.set(h, ok);
  return ok;
}

export interface Hop {
  from: string;
  to: string;
  status: number;
}
export interface FetchResult {
  status: number;
  url: string; // final URL after redirects
  hops: Hop[];
  headers: Record<string, string>;
  contentType: string;
  text: string; // empty for non-text responses
  bytes: number;
  ms: number;
}

export async function fetchPage(url: string, opts: { timeout?: number; method?: 'GET' | 'HEAD'; accept?: string } = {}): Promise<FetchResult | null> {
  const hops: Hop[] = [];
  let cur = url;
  const started = Date.now();
  for (let i = 0; i <= MAX_HOPS; i++) {
    let u: URL;
    try {
      u = new URL(cur);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || !(await isPublicHost(u.hostname))) return null;
    let r: Response;
    try {
      r = await fetch(cur, {
        method: opts.method ?? 'GET',
        headers: { 'User-Agent': CRAWL_UA, Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'gzip, br' },
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeout ?? 15000),
      });
    } catch {
      return null;
    }
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      let next: string;
      try {
        next = new URL(loc, cur).toString();
      } catch {
        return null;
      }
      hops.push({ from: cur, to: next, status: r.status });
      cur = next;
      continue;
    }
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const contentType = headers['content-type'] ?? '';
    let text = '';
    let bytes = Number(headers['content-length']) || 0;
    if ((opts.method ?? 'GET') === 'GET' && (/text|xml|json|html/i.test(contentType) || !contentType)) {
      const buf = Buffer.from(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
      bytes = buf.length;
      text = buf.subarray(0, MAX_BODY).toString('utf8');
    }
    return { status: r.status, url: cur, hops, headers, contentType, text, bytes, ms: Date.now() - started };
  }
  return { status: 310, url: cur, hops, headers: {}, contentType: '', text: '', bytes: 0, ms: Date.now() - started }; // redirect loop / too many hops
}

// ---- robots.txt ---------------------------------------------------------------------------------------------

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}
export interface Robots {
  exists: boolean;
  groups: RobotsGroup[];
  sitemaps: string[];
  size: number;
}

export function parseRobots(text: string | null): Robots {
  if (!text) return { exists: false, groups: [], sitemaps: [], size: 0 };
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'sitemap') sitemaps.push(v);
    else if (k === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if (cur && (k === 'allow' || k === 'disallow')) {
      if (v) cur[k].push(v);
    }
    lastWasAgent = false;
  }
  return { exists: true, groups, sitemaps, size: text.length };
}

function ruleToRegex(rule: string): RegExp {
  const esc = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc.replace(/\\\$$/, '$'));
}

// Longest matching rule wins; Allow wins a tie (Google's documented behaviour). Group = most specific user-agent match, else "*".
export function robotsAllows(r: Robots, agent: string, path: string): boolean {
  if (!r.exists) return true;
  const a = agent.toLowerCase();
  let group = r.groups.find((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  if (!group) group = r.groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = { len: -1, allow: true };
  for (const [list, allow] of [[group.disallow, false], [group.allow, true]] as Array<[string[], boolean]>) {
    for (const rule of list) {
      if (ruleToRegex(rule).test(path) && (rule.length > best.len || (rule.length === best.len && allow))) best = { len: rule.length, allow };
    }
  }
  return best.allow;
}

// Pool with a cap on concurrency; keeps result order.
export async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}
