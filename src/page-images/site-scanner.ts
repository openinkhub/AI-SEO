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
