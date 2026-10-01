import { TechnicalAnalysis } from './technical-analyzer';

export interface TaskFinding {
  finding: string;
  suggestion: string | null;
}

// One finding/suggestion pair per entry in AUTOMATED_SKILL_IDS, built from
// the single shared TechnicalAnalysis for the run. Several skill ids share
// the same finding text where the underlying check genuinely is the same
// thing under a different plugin's name (e.g. every *:seo-sitemap skill).
export function buildAutomatedFinding(skillId: string, a: TechnicalAnalysis): TaskFinding {
  switch (skillId) {
    case 'seo-aeo-geo-ultimate:seo-technical':
    case 'seo-skills:seo-technical-audit':
    case 'searchfit-seo:technical-seo':
      return fundamentals(a);

    case 'searchfit-seo:seo-audit':
    case 'ubersuggest:seo-foundations':
    case 'ubersuggest:site-audit':
    case 'citable:ai-search-audit':
    case 'claude-site-audit:seo-audit':
      return fundamentals(a);

    case 'searchfit-seo:on-page-seo':
    case 'searchfit-seo:seo-check':
      return onPage(a);

    case 'seo-aeo-geo-ultimate:seo-sitemap':
    case 'seo-skills:seo-sitemap':
      return sitemap(a);

    case 'seo-aeo-geo-ultimate:seo-images':
    case 'seo-skills:seo-images':
      return images(a);

    case 'seo-aeo-geo-ultimate:seo-schema':
    case 'seo-skills:seo-schema':
    case 'searchfit-seo:schema-markup':
      return schema(a);

    case 'seo-aeo-geo-ultimate:seo-agentic':
    case 'maquinable-geo:seo-audit':
      return agentic(a);

    case 'searchfit-seo:broken-links':
      return brokenLinks(a);

    default:
      return {
        finding: a.fetchedHomepage
          ? 'Homepage reachable; no automated check implemented for this skill yet.'
          : `Could not fetch ${a.website} to run this check.`,
        suggestion: null,
      };
  }
}

function fundamentals(a: TechnicalAnalysis): TaskFinding {
  if (!a.fetchedHomepage) {
    return { finding: `Could not fetch ${a.website} — site may be down or blocking requests.`, suggestion: 'Confirm the site is live and not blocking the Engine\'s fetch (check firewall/WAF rules).' };
  }
  const issues: string[] = [];
  if (!a.title) issues.push('no <title> tag found');
  if (!a.metaDescription) issues.push('no meta description found');
  if (a.h1Count === 0) issues.push('no H1 found');
  if (a.h1Count > 1) issues.push(`${a.h1Count} H1 tags found (should be 1)`);
  if (!a.canonical) issues.push('no canonical tag found');
  if (!a.sitemapFound) issues.push('sitemap.xml not found at the root');
  if (!a.robotsTxtFound) issues.push('robots.txt not found at the root');
  if (issues.length === 0) {
    return { finding: 'Homepage fundamentals look sound: title, meta description, a single H1, canonical tag, sitemap.xml and robots.txt are all present.', suggestion: null };
  }
  return {
    finding: `Homepage fundamentals: ${issues.join('; ')}.`,
    suggestion: 'Add the missing tags/files; each is a one-line fix with outsized SEO impact.',
  };
}

function onPage(a: TechnicalAnalysis): TaskFinding {
  const titleLen = a.title?.length ?? 0;
  const descLen = a.metaDescription?.length ?? 0;
  const notes: string[] = [];
  if (a.title && (titleLen < 15 || titleLen > 65)) notes.push(`title is ${titleLen} chars (ideal ~15-65)`);
  if (a.metaDescription && (descLen < 50 || descLen > 165)) notes.push(`meta description is ${descLen} chars (ideal ~50-165)`);
  if (notes.length === 0) {
    return { finding: a.title ? `Title ("${a.title}") and meta description lengths are within range.` : 'No title tag to evaluate.', suggestion: null };
  }
  return { finding: notes.join('; ') + '.', suggestion: 'Tighten the title/description to the ideal length so search engines stop truncating them.' };
}

function sitemap(a: TechnicalAnalysis): TaskFinding {
  if (!a.sitemapFound) {
    return { finding: 'No sitemap.xml found at the site root.', suggestion: 'Generate and submit a sitemap.xml (Layer 22 already does this for Openink Hub-managed sites).' };
  }
  return { finding: `sitemap.xml found with ${a.sitemapUrlCount} <loc> entries.`, suggestion: a.sitemapUrlCount === 0 ? 'Sitemap exists but lists zero URLs — check the generator.' : null };
}

function images(a: TechnicalAnalysis): TaskFinding {
  if (a.imageCount === 0) {
    return { finding: 'No <img> tags found on the homepage.', suggestion: null };
  }
  if (a.imagesMissingAlt === 0) {
    return { finding: `All ${a.imageCount} homepage images have alt text.`, suggestion: null };
  }
  return {
    finding: `${a.imagesMissingAlt} of ${a.imageCount} homepage images are missing (or have empty) alt text.`,
    suggestion: 'Add descriptive alt text to every image — accessibility and image-search ranking both depend on it.',
  };
}

function schema(a: TechnicalAnalysis): TaskFinding {
  if (a.jsonLdTypes.length === 0) {
    return { finding: 'No JSON-LD structured data found on the homepage.', suggestion: 'Add Organization/WebSite JSON-LD at minimum; add page-specific schema (Article, FAQPage, Product) where relevant.' };
  }
  return { finding: `JSON-LD structured data present: ${a.jsonLdTypes.join(', ')}.`, suggestion: null };
}

function agentic(a: TechnicalAnalysis): TaskFinding {
  if (!a.robotsTxtFound) {
    return { finding: 'No robots.txt found — AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot) have no explicit directives either way.', suggestion: 'Publish a robots.txt that explicitly allows the AI crawlers you want citing your content.' };
  }
  const blocked = a.aiBotBlocked.filter((b) => b.blocked).map((b) => b.bot);
  const parts = [
    blocked.length === 0
      ? 'robots.txt does not fully block any of the tracked AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot).'
      : `robots.txt fully blocks: ${blocked.join(', ')}.`,
    a.llmsTxtFound ? 'llms.txt is present.' : 'llms.txt was not found.',
  ];
  return {
    finding: parts.join(' '),
    suggestion: blocked.length > 0 || !a.llmsTxtFound
      ? 'Review whether blocking those crawlers is intentional, and consider adding an llms.txt to guide AI-answer engines to your best content.'
      : null,
  };
}

function brokenLinks(a: TechnicalAnalysis): TaskFinding {
  return {
    finding: a.fetchedHomepage
      ? 'Homepage fetched successfully; a full broken-link crawl (beyond the homepage) is not yet wired — needs a multi-page crawl budget.'
      : `Could not fetch ${a.website} at all — treat as a site-wide broken-link risk until confirmed otherwise.`,
    suggestion: 'Run a full-site crawl (seo-firecrawl / seo-api skills) once that integration exists, to check every internal link, not just the homepage.',
  };
}
