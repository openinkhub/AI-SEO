import axios from 'axios';
import { withProtocol } from '../page-images/url-utils';

const FETCH_TIMEOUT_MS = 8000;
const AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

// The real, live, no-paid-API technical scan behind AUTOMATED_SKILL_IDS.
// One scan per AuditRun — every automated skill reuses this single result
// rather than re-fetching the site per skill.
export interface TechnicalAnalysis {
  website: string;
  fetchedHomepage: boolean;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  canonical: string | null;
  imageCount: number;
  imagesMissingAlt: number;
  jsonLdTypes: string[];
  sitemapFound: boolean;
  sitemapUrlCount: number;
  robotsTxtFound: boolean;
  aiBotBlocked: Array<{ bot: string; blocked: boolean }>;
  llmsTxtFound: boolean;
}

export async function analyzeWebsite(website: string): Promise<TechnicalAnalysis> {
  const base = withProtocol(website);
  const [homepage, sitemap, robots, llmsTxt] = await Promise.all([
    fetchText(base),
    fetchText(`${base}/sitemap.xml`),
    fetchText(`${base}/robots.txt`),
    fetchText(`${base}/llms.txt`),
  ]);

  const html = homepage ?? '';
  const jsonLdTypes = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  )
    .map((m) => extractJsonLdType(m[1]))
    .filter((t): t is string => !!t);

  const images = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]);
  const imagesMissingAlt = images.filter(
    (tag) => !/alt=["'][^"']*["']/i.test(tag) || /alt=["']\s*["']/i.test(tag),
  ).length;

  return {
    website: base,
    fetchedHomepage: homepage !== null,
    title: firstMatch(html, /<title[^>]*>([^<]*)<\/title>/i),
    metaDescription: firstMatch(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ),
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    canonical: firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    imageCount: images.length,
    imagesMissingAlt,
    jsonLdTypes,
    sitemapFound: sitemap !== null,
    sitemapUrlCount: sitemap ? (sitemap.match(/<loc>/gi) ?? []).length : 0,
    robotsTxtFound: robots !== null,
    aiBotBlocked: AI_BOTS.map((bot) => ({
      bot,
      blocked: robots ? isBotBlocked(robots, bot) : false,
    })),
    llmsTxtFound: llmsTxt !== null,
  };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: (s) => s === 200,
    });
    return data;
  } catch {
    return null;
  }
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function extractJsonLdType(blockRaw: string): string | null {
  try {
    const parsed = JSON.parse(blockRaw.trim());
    const node = Array.isArray(parsed) ? parsed[0] : parsed;
    const type = node?.['@type'];
    if (!type) return null;
    return Array.isArray(type) ? type.join(', ') : String(type);
  } catch {
    return null;
  }
}

// Heuristic robots.txt check: looks for a "User-agent: <bot>" (or "*")
// block followed by a bare "Disallow: /" before the next User-agent line.
// Good enough to surface an obvious full block; not a full robots.txt
// parser (no wildcard path matching, no Allow-overrides-Disallow logic).
function isBotBlocked(robotsTxt: string, bot: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inBlock = false;
  let blocked = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^user-agent:/i.test(line)) {
      const ua = line.split(':').slice(1).join(':').trim();
      inBlock = ua.toLowerCase() === bot.toLowerCase() || ua === '*';
      continue;
    }
    if (inBlock && /^disallow:/i.test(line)) {
      const path = line.split(':').slice(1).join(':').trim();
      if (path === '/') blocked = true;
    }
  }
  return blocked;
}
