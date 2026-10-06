import axios from 'axios';
import { sameDomain, withProtocol } from './url-utils';

const MAX_SITEMAP_URLS = 200;
const MAX_HOMEPAGE_LINKS = 50;
const FETCH_TIMEOUT_MS = 8000;

// Lightweight, dependency-free live site scan: try sitemap.xml first (regex
// over <loc> tags — avoids pulling in a full XML parser for one tag), then
// fall back to scanning same-domain hrefs on the homepage HTML. Mirrors the
// WP plugin's KP21_Website_Content::live_site_scan() fallback chain, minus
// its Browserless.io JS-rendering fallback for SPA sites (not wired here —
// flagged as a future improvement once that service's credentials exist
// for the Engine too).
export async function liveSiteScan(website: string): Promise<string[]> {
  const base = withProtocol(website);
  const host = new URL(base).hostname;

  const fromSitemap = await trySitemap(base, host);
  if (fromSitemap.length > 0) return fromSitemap;

  return tryHomepageLinks(base, host);
}

async function trySitemap(base: string, host: string): Promise<string[]> {
  try {
    const { data } = await axios.get<string>(`${base}/sitemap.xml`, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      headers: { Accept: 'application/xml,text/xml' },
    });
    const locs = Array.from(data.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map(
      (m) => m[1],
    );
    const urls = locs.filter((u) => sameDomain(u, host));
    return dedupe(urls).slice(0, MAX_SITEMAP_URLS);
  } catch {
    return [];
  }
}

async function tryHomepageLinks(base: string, host: string): Promise<string[]> {
  try {
    const { data } = await axios.get<string>(base, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      headers: { Accept: 'text/html' },
    });
    const hrefs = Array.from(data.matchAll(/href=["']([^"'#]+)["']/gi)).map(
      (m) => m[1],
    );
    const resolved = hrefs
      .map((h) => {
        try {
          return new URL(h, base).toString();
        } catch {
          return null;
        }
      })
      .filter((u): u is string => !!u && sameDomain(u, host));
    return dedupe([base, ...resolved]).slice(0, MAX_HOMEPAGE_LINKS);
  } catch {
    return [base];
  }
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

// ---- H1 extraction ----

const H1_CONCURRENCY = 6;
const MAX_HTML_BYTES = 3 * 1024 * 1024;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
}

// First non-empty <h1> text in the HTML (tags/scripts stripped, entities
// decoded, whitespace collapsed, capped at 200 chars), or null.
export function extractH1FromHtml(html: string): string | null {
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1]
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
    const text = decodeEntities(inner).replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 200);
  }
  return null;
}

export async function fetchH1(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(withProtocol(url), {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_HTML_BYTES,
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; OpenInkHubBot/1.0)',
      },
    });
    return typeof data === 'string' ? extractH1FromHtml(data) : null;
  } catch {
    return null;
  }
}

// Fetches H1s for many URLs with limited concurrency. Stops starting new
// fetches once budgetMs has elapsed (keeps one HTTP request from running
// past the host's proxy timeout); URLs not reached are simply absent from
// the result and can be retried with the "Extract H1" action.
export async function fetchH1Many(
  urls: string[],
  budgetMs: number,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const deadline = Date.now() + budgetMs;
  let next = 0;
  const worker = async () => {
    while (Date.now() < deadline) {
      const idx = next++;
      if (idx >= urls.length) return;
      out.set(urls[idx], await fetchH1(urls[idx]));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(H1_CONCURRENCY, urls.length) }, worker),
  );
  return out;
}
