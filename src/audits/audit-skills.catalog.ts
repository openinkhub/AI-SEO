// Layer 69 — "Complete Website Audit" skill catalog.
//
// Static transcription of the "SEO Skill Matrix" (140 skills across 10
// plugin groups), the authoritative source for every SEO/AEO/GEO skill
// Openink Hub's tooling can run. This file is data, not behaviour: the
// AuditsService snapshots one AuditTask per skill per run (snapshot-at-
// creation pattern, same as Layer 21's blog snapshot), so a later edit to
// this catalog never rewrites history on a completed run.
//
// Tuple shape per skill: [plugin, skill, finds, actionOutput, resultNature,
// implementationType, layerMappingRaw]. implementationType drives the
// derived actionType (internal/external/reported) via IMPL_TO_ACTION below,
// matching the taxonomy already defined in claude/new-app-draft.md.
import { parseLayerNumbers } from './parse-layers';

export type ImplementationType =
  | 'keyword-update'
  | 'monitoring'
  | 'content-edit'
  | 'schema'
  | 'publish'
  | 'new-build'
  | 'site-config'
  | 'reporting'
  | 'outreach'
  | 'strategy';

export type ActionType = 'internal' | 'external' | 'reported';

export const IMPL_LABEL: Record<ImplementationType, string> = {
  'content-edit': 'Content edit (existing)',
  'new-build': 'New page/content build',
  schema: 'Schema / structured data',
  'keyword-update': 'Keyword/metadata update',
  outreach: 'Backlink outreach (manual)',
  monitoring: 'Monitoring/tracking setup',
  'site-config': 'Site/server config',
  strategy: 'Strategic decision (human)',
  reporting: 'Reporting only',
  publish: 'Multi-platform publish',
};

const IMPL_TO_ACTION: Record<ImplementationType, ActionType> = {
  'keyword-update': 'internal',
  monitoring: 'internal',
  'content-edit': 'external',
  schema: 'external',
  publish: 'external',
  'new-build': 'external',
  'site-config': 'reported',
  reporting: 'reported',
  outreach: 'reported',
  strategy: 'reported',
};

type SkillTuple = [
  plugin: string,
  skill: string,
  finds: string,
  actionOutput: string,
  resultNature: string,
  implementationType: ImplementationType,
  layerMappingRaw: string,
];

interface SkillGroupDef {
  group: string;
  skills: SkillTuple[];
}

export const AUDIT_SKILL_GROUPS: SkillGroupDef[] = [
  {
    group: 'SEO · AEO · GEO Ultimate',
    skills: [
      ['seo-aeo-geo-ultimate', 'seo', 'which of its specialist skills apply', 'runs them all, returns one consolidated plan', 'Consolidated multi-skill report', 'reporting', 'N/A — orchestrates other skills, no direct layer'],
      ['seo-aeo-geo-ultimate', 'seo-audit', 'technical SEO issues sitewide', 'prioritized fix list', 'Diagnostic report (issue list)', 'content-edit', 'Layer 21/22 — Website Blog / Website Content'],
      ['seo-aeo-geo-ultimate', 'seo-technical', 'crawlability / indexation problems', 'technical fix list', 'Diagnostic report', 'site-config', 'Layers 26/27/29/69 — Technical SEO (sub-scope not yet fully documented)'],
      ['seo-aeo-geo-ultimate', 'seo-aeo', 'AI-answer-engine readiness gaps', 'AEO optimization plan', 'Diagnostic + strategic plan', 'content-edit', 'Layer 21/22'],
      ['seo-aeo-geo-ultimate', 'seo-geo', 'GEO citation-readiness gaps', 'FAQ / schema / TL;DR content layer', 'Content-layer recommendation', 'schema', 'Propose new — Schema/GEO-Layer Generator'],
      ['seo-aeo-geo-ultimate', 'seo-content', 'content quality & coverage gaps', 'content brief + rewrite plan', 'Content draft/brief', 'content-edit', 'Layer 21 — Website Blog'],
      ['seo-aeo-geo-ultimate', 'seo-research', 'keyword & topic opportunities', 'keyword/topic shortlist', 'Keyword/topic list', 'keyword-update', 'Layers 4–14 — Keyword Planner/Research'],
      ['seo-aeo-geo-ultimate', 'seo-plan', 'full-site SEO gaps', 'phased roadmap', 'Strategic roadmap', 'strategy', 'N/A — human-reviewed plan, no direct layer'],
      ['seo-aeo-geo-ultimate', 'seo-action-plan', 'audit findings', 'step-by-step task list', 'Strategic task list', 'strategy', 'N/A — candidate input for the proposed Engine roadmap_actions table'],
      ['seo-aeo-geo-ultimate', 'seo-architecture', 'site / IA structure issues', 'restructuring recommendations', 'Structural recommendation', 'strategy', 'Propose new — Site Architecture/IA Layer'],
      ['seo-aeo-geo-ultimate', 'seo-schema', 'missing structured data', 'JSON-LD to paste', 'Structured-data snippet', 'schema', 'Propose new — Schema Generation Layer'],
      ['seo-aeo-geo-ultimate', 'seo-sitemap', 'sitemap gaps or errors', 'corrected sitemap', 'Diagnostic + config fix', 'site-config', 'Layer 22 — Website Content (sitemap.xml already generated here)'],
      ['seo-aeo-geo-ultimate', 'seo-hreflang', 'international targeting errors', 'hreflang fix', 'Diagnostic + config fix', 'site-config', 'Propose new — International/hreflang Layer'],
      ['seo-aeo-geo-ultimate', 'seo-images', 'image SEO issues (alt/size)', 'image optimization list', 'Diagnostic report', 'content-edit', 'Layer 21 (Blog Image) / Layer 22'],
      ['seo-aeo-geo-ultimate', 'seo-local', 'local-pack / GMB gaps', 'local SEO fix plan', 'Diagnostic + plan', 'site-config', 'Propose new — Local/GMB Layer'],
      ['seo-aeo-geo-ultimate', 'seo-authority', 'backlink / authority gaps', 'link-building plan', 'Backlink/authority diagnostic', 'outreach', 'Existing: KP21_Backlink_Monitor verifies plugin-published links (Layers 21/23/24/25/28/60) — new-link prospecting is Propose new — Backlink Outreach Layer'],
      ['seo-aeo-geo-ultimate', 'seo-competitor-pages', 'competitor page advantages', 'page-level improvement plan', 'Competitive diagnostic', 'content-edit', 'Layer 21'],
      ['seo-aeo-geo-ultimate', 'seo-commerce', 'ecommerce SEO issues', 'product/category fix plan', 'Diagnostic report', 'content-edit', 'N/A — only relevant for ecommerce sites'],
      ['seo-aeo-geo-ultimate', 'seo-programmatic', 'scalable page-template opportunities', 'programmatic SEO page plan', 'Strategic plan + template design', 'new-build', 'Propose new — Programmatic Page Layer'],
      ['seo-aeo-geo-ultimate', 'seo-performance', 'Core Web Vitals / speed issues', 'performance fix list', 'Diagnostic report', 'site-config', 'Layers 26/27/29/69 — Technical SEO'],
      ['seo-aeo-geo-ultimate', 'seo-video', 'video SEO gaps', 'video schema & optimization plan', 'Diagnostic + schema', 'schema', 'Propose new — Video Schema Layer'],
      ['seo-aeo-geo-ultimate', 'seo-news-discover', 'Google News/Discover eligibility gaps', 'eligibility fix plan', 'Diagnostic report', 'site-config', 'N/A — only relevant for news publishers'],
      ['seo-aeo-geo-ultimate', 'seo-agentic', 'AI-bot crawler accessibility issues', 'crawler-access fix plan', 'Diagnostic report', 'site-config', 'Layer 22 — Website Content (robots.txt/site config)'],
      ['seo-aeo-geo-ultimate', 'ai-search-research', 'how AI engines currently answer for the topic', 'content gaps to close', 'AI-answer content-gap report', 'content-edit', 'Layer 21 — Website Blog'],
      ['seo-aeo-geo-ultimate', 'ai-visibility-monitor', 'brand mentions across AI engines', 'visibility trend report', 'Monitoring/tracking output', 'monitoring', 'Propose new — AI-Search Monitoring Layer (mangools AI Watcher / SE Ranking SEV)'],
      ['seo-aeo-geo-ultimate', 'optimise-seo', 'on-page SEO weaknesses', 'rewritten on-page elements', 'Content rewrite', 'content-edit', 'Layer 21/22'],
    ],
  },
  {
    group: 'SEO Skills',
    skills: [
      ['seo-skills', 'seo-technical-audit', 'crawl / index / technical issues', 'fix list', 'Diagnostic report', 'site-config', 'Layers 26/27/29/69'],
      ['seo-skills', 'seo-content-audit', 'thin or stale content', 'rewrite / consolidation plan', 'Content diagnostic', 'content-edit', 'Layer 21'],
      ['seo-skills', 'seo-content-brief', 'SERP intent & competitor structure', 'content brief', 'Content brief', 'content-edit', 'Layer 21'],
      ['seo-skills', 'seo-competitor-gap-analysis', 'content & keyword gaps vs competitors', 'gap-closing plan', 'Competitive diagnostic', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['seo-skills', 'seo-competitor-pages', 'competitor page tactics', 'page improvement plan', 'Competitive diagnostic', 'content-edit', 'Layer 21'],
      ['seo-skills', 'seo-backlink-gap', 'backlink gaps vs competitors', 'link prospecting list', 'Backlink prospect list', 'outreach', 'Existing: KP21_Backlink_Monitor verifies plugin-published links only — competitor-gap prospecting is Propose new — Backlink Outreach Layer'],
      ['seo-skills', 'seo-backlinks-profile', "own backlink profile health", 'toxic / opportunity link list', 'Backlink diagnostic', 'outreach', 'Existing: KP21_Backlink_Monitor verifies plugin-published links (Layers 21/23/24/25/28/60) — full external backlink-profile discovery is Propose new — Backlink Outreach Layer'],
      ['seo-skills', 'seo-keyword-cluster', 'raw keyword list', 'topic clusters mapped to pages', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['seo-skills', 'seo-keyword-niche', 'niche keyword opportunities', 'keyword shortlist', 'Keyword list', 'keyword-update', 'Layers 4–14'],
      ['seo-skills', 'seo-drift', 'ranking drift over time', 'alert + cause analysis', 'Monitoring output', 'monitoring', 'Propose new — Rank-Tracking Layer (mangools SERPWatcher)'],
      ['seo-skills', 'seo-schema', 'missing schema markup', 'JSON-LD', 'Structured-data snippet', 'schema', 'Propose new — Schema Generation Layer'],
      ['seo-skills', 'seo-sitemap', 'sitemap issues', 'fixed sitemap', 'Diagnostic + config fix', 'site-config', 'Layer 22'],
      ['seo-skills', 'seo-hreflang', 'hreflang errors', 'corrected hreflang tags', 'Diagnostic + config fix', 'site-config', 'Propose new — International/hreflang Layer'],
      ['seo-skills', 'seo-images', 'image SEO gaps', 'optimization list', 'Diagnostic report', 'content-edit', 'Layer 21/22'],
      ['seo-skills', 'seo-local', 'local visibility gaps', 'local fix plan', 'Diagnostic + plan', 'site-config', 'Propose new — Local/GMB Layer'],
      ['seo-skills', 'local-gmb-visibility', 'Google Business Profile gaps', 'GMB optimization plan', 'Diagnostic + plan', 'site-config', 'Propose new — Local/GMB Layer'],
      ['seo-skills', 'seo-page', 'single-page SEO issues', 'on-page fix list', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-skills', 'seo-plan', 'full-site gaps', 'phased plan', 'Strategic roadmap', 'strategy', 'N/A — human-reviewed plan'],
      ['seo-skills', 'seo-subdomain', 'subdomain SEO structure issues', 'subdomain strategy', 'Diagnostic + strategy', 'site-config', 'N/A — only relevant with subdomains in use'],
      ['seo-skills', 'seo-sxo', 'search-experience (UX+SEO) issues', 'SXO fix plan', 'Diagnostic report', 'site-config', 'Layers 26/27/29/69'],
      ['seo-skills', 'seo-geo', 'GEO / AI-citation gaps', 'GEO content layer', 'Content-layer recommendation', 'schema', 'Propose new — Schema/GEO-Layer Generator'],
      ['seo-skills', 'seo-google', 'Search Console data', 'actionable report', 'Diagnostic report (GSC-sourced)', 'monitoring', 'Propose new — GSC/GA4 Integration Layer (Layer 12 only reads GSC for keyword query today)'],
      ['seo-skills', 'seo-ads', 'paid-search performance gaps', 'ads optimization plan', 'Diagnostic report', 'strategy', 'N/A — no paid-ads layer exists'],
      ['seo-skills', 'seo-api', 'raw API pull needed', 'structured dataset', 'Raw data pull', 'reporting', 'N/A — data-gathering only, feeds other layers'],
      ['seo-skills', 'seo-firecrawl', 'full-site crawl needed', 'structured crawl dataset', 'Raw crawl dataset', 'reporting', 'N/A — data-gathering only'],
      ['seo-skills', 'ai-search-gaps-to-social-campaign', 'AI-search content gaps', 'social campaign brief', 'Content/campaign brief', 'new-build', 'Layer 60 — Social Blog'],
      ['seo-skills', 'seo-ai-search-share-of-voice', "brand's AI-answer share of voice", 'share-of-voice report', 'Monitoring output', 'monitoring', 'Propose new — AI-Search Monitoring Layer'],
      ['seo-skills', 'seo-ai-social-report', 'AI-search + social performance', 'combined report', 'Combined monitoring report', 'monitoring', 'Propose new — AI-Search Monitoring Layer + Layer 60'],
      ['seo-skills', 'site-audit-to-social-distribution', 'audit findings', 'social distribution plan', 'Content/campaign brief', 'new-build', 'Layer 60 — Social Blog'],
      ['seo-skills', 'seo-agency-landing-page', "agency positioning need", 'landing-page copy', 'Content draft', 'new-build', "Propose new — New Page Builder Layer (only relevant for Openink Hub's own site, not client sites)"],
      ["seo-skills", "client-onboarding-proposal", "client's current SEO state", "onboarding proposal doc", "Strategic proposal document", "strategy", "N/A — human deliverable, no plugin layer"],
    ],
  },
  {
    group: 'SearchFit SEO',
    skills: [
      ['searchfit-seo', 'seo-audit', 'site SEO health', 'prioritized findings', 'Diagnostic report', 'content-edit', 'Layer 21/22'],
      ['searchfit-seo', 'on-page-seo', 'page-level SEO issues', 'on-page fix list', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['searchfit-seo', 'technical-seo', 'crawl / index / technical issues', 'technical fix list', 'Diagnostic report', 'site-config', 'Layers 26/27/29/69'],
      ['searchfit-seo', 'content-brief', 'SERP + competitor research', 'content brief', 'Content brief', 'content-edit', 'Layer 21'],
      ['searchfit-seo', 'content-strategy', 'site content gaps', 'content roadmap', 'Strategic roadmap', 'strategy', 'N/A — human-reviewed plan'],
      ['searchfit-seo', 'keyword-clustering', 'keyword list', 'topical clusters + page map', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['searchfit-seo', 'schema-markup', 'missing structured data', 'JSON-LD to paste', 'Structured-data snippet', 'schema', 'Propose new — Schema Generation Layer'],
      ['searchfit-seo', 'ai-visibility', 'AI-engine visibility', 'visibility score + gaps', 'Monitoring output', 'monitoring', 'Propose new — AI-Search Monitoring Layer'],
      ['searchfit-seo', 'broken-links', 'broken internal/external links', 'fix list', 'Diagnostic report', 'content-edit', 'Layer 21/22'],
      ['searchfit-seo', 'internal-linking', 'internal link gaps', 'linking recommendations', 'Diagnostic + recommendation', 'content-edit', 'Layer 21'],
      ['searchfit-seo', 'content-translation', 'content needing localization', 'translated & localized content', 'Content draft', 'new-build', 'Propose new — Localization Layer'],
      ['searchfit-seo', 'create-content', 'a topic or keyword', 'full SEO-optimized article', 'Content draft', 'content-edit', 'Layer 21'],
      ['searchfit-seo', 'create-topic', 'topic research need', 'topic plan with keyword map', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['searchfit-seo', 'generate-schema', "a page's content", 'JSON-LD schema', 'Structured-data snippet', 'schema', 'Propose new — Schema Generation Layer'],
      ['searchfit-seo', 'keyword-cluster', 'keyword list', 'clusters + content recs', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['searchfit-seo', 'seo-check', 'current file / page', 'instant SEO checklist result', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['searchfit-seo', 'translate-content', 'content in one language', 'localized, keyword-researched translation', 'Content draft', 'new-build', 'Propose new — Localization Layer'],
    ],
  },
  {
    group: 'Ubersuggest',
    skills: [
      ['ubersuggest', 'keyword-research', 'search volume & difficulty data', 'keyword list', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['ubersuggest', 'competitor-analysis', 'competitor keyword/traffic data', 'competitive gap report', 'Competitive diagnostic', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['ubersuggest', 'content-brief', 'SERP data', 'content brief', 'Content brief', 'content-edit', 'Layer 21'],
      ['ubersuggest', 'content-demand-finder', 'trending / demand topics', 'topic opportunities', 'Strategic content plan', 'strategy', 'N/A — human-reviewed plan'],
      ['ubersuggest', 'site-audit', 'technical SEO issues', 'fix list', 'Diagnostic report', 'content-edit', 'Layer 21/22'],
      ['ubersuggest', 'ai-visibility', 'AI-search visibility', 'visibility report', 'Monitoring output', 'monitoring', 'Propose new — AI-Search Monitoring Layer'],
      ['ubersuggest', 'seo-foundations', 'baseline SEO setup issues', 'foundational checklist', 'Diagnostic report', 'content-edit', 'Layer 21/22'],
      ['ubersuggest', 'seo-action-plan', 'audit findings', 'prioritized action plan', 'Strategic task list', 'strategy', 'N/A'],
      ['ubersuggest', 'project-setup', 'a new site to track', 'configured SEO project', 'Monitoring/tracking config', 'monitoring', 'N/A — external tool config, no plugin layer'],
    ],
  },
  {
    group: 'HarborRank',
    skills: [
      ['harborrank', 'keyword-research', 'keyword volume/difficulty metrics', 'keyword shortlist', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['harborrank', 'keyword-clustering', 'keyword list', 'topic clusters', 'Keyword/topic list', 'keyword-update', 'Layers 4–14'],
      ['harborrank', 'competitor-analysis', 'competitor rankings & content', 'gap report', 'Competitive diagnostic', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['harborrank', 'competitive-landscape', 'market/competitor positioning', 'landscape map', 'Competitive diagnostic', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['harborrank', 'link-prospecting', 'backlink opportunities', 'outreach prospect list', 'Backlink prospect list', 'outreach', 'Existing: KP21_Backlink_Monitor verifies plugin-published links only — new-link prospecting is Propose new — Backlink Outreach Layer'],
      ['harborrank', 'seo-coach', 'ongoing SEO questions', 'recommendations / coaching', 'Advisory/coaching output', 'strategy', 'N/A — advisory only'],
      ['harborrank', 'seo-project-setup', 'a new site', 'configured SEO tracking project', 'Monitoring/tracking config', 'monitoring', 'N/A — external tool config, no plugin layer'],
    ],
  },
  {
    group: 'SEO GSC Wizard',
    skills: [
      ['seo-gsc-wizard', 'site-audit', 'GSC + technical data', 'audit report', 'Diagnostic report', 'monitoring', 'Propose new — GSC/GA4 Integration Layer'],
      ['seo-gsc-wizard', 'content-decay', 'pages losing traffic over time', 'refresh priority list', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-gsc-wizard', 'cannibalization', 'pages competing for the same keyword', 'consolidation plan', 'Diagnostic report', 'content-edit', 'Layer 21 (Meta Title/Tags/Target Webpage edits)'],
      ['seo-gsc-wizard', 'quick-wins', 'near-page-1 keywords', 'quick-win action list', 'Keyword opportunity list', 'keyword-update', 'Layers 4–14 + Layer 21'],
      ['seo-gsc-wizard', 'indexing-health', 'indexing errors / coverage issues', 'indexing fix list', 'Diagnostic report', 'site-config', 'Propose new — GSC/GA4 Integration Layer'],
      ['seo-gsc-wizard', 'weekly-report', 'GSC + GA4 data', 'weekly performance report', 'Monitoring report', 'monitoring', 'Propose new — GSC/GA4 Integration Layer'],
    ],
  },
  {
    group: 'SEO Writers',
    skills: [
      ['seo-writers', 'audit-content-library', 'existing content inventory', 'audit findings', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-writers', 'audit-eeat', 'E-E-A-T signal gaps', 'E-E-A-T fix list', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-writers', 'audit-paragraph-structure', 'readability / structure issues', 'structural edit list', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-writers', 'audit-tone-honesty', 'tone / authenticity issues', 'tone fix notes', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-writers', 'audit-useful-action', 'actionability gaps', 'actionable-content rewrite notes', 'Diagnostic report', 'content-edit', 'Layer 21'],
      ['seo-writers', 'chief-editor-review', 'draft quality issues', 'editorial review + revisions', 'Content review/edit', 'content-edit', 'Layer 21'],
      ['seo-writers', 'cold-reader-review', 'fresh-reader confusion points', 'clarity fixes', 'Content review/edit', 'content-edit', 'Layer 21'],
      ['seo-writers', 'draft-article', 'a content brief', 'full draft article', 'Content draft', 'content-edit', 'Layer 21'],
      ['seo-writers', 'edit-article', 'a flagged draft', 'edited article', 'Content edit', 'content-edit', 'Layer 21'],
      ['seo-writers', 'final-integration-check', 'pre-publish inconsistencies', 'final go / no-go check', 'Pre-publish check', 'content-edit', 'Layer 21'],
      ['seo-writers', 'load-author-voice', "an author's style samples", 'voice profile for drafting', 'Voice/config profile', 'content-edit', 'Layer 21 (feeds prompt config)'],
      ['seo-writers', 'render-mermaid-infographic', 'a process or dataset', 'Mermaid infographic', 'Visual asset', 'new-build', 'Propose new — Infographic/Visual Asset Layer'],
      ['seo-writers', 'visual-storytelling', 'narrative gaps in a draft', 'visual storytelling plan', 'Strategic content plan', 'content-edit', 'Layer 21'],
      ['seo-writers', 'run-seo-writing-workflow', 'a brief', 'full end-to-end article pipeline run', 'Full pipeline output', 'content-edit', 'Layer 21'],
      ['seo-writers', 'cms-draft-handoff', 'a finished draft', 'CMS-ready handoff package', 'Publish-ready package', 'publish', 'Layer 23 — Website Blog Publishing/API'],
    ],
  },
  {
    group: 'AI-Search / GEO Audits',
    skills: [
      ['citable', 'ai-search-audit', 'AI-search visibility (ChatGPT/Claude/Perplexity/AI Overviews) + SEO foundations underneath', 'visibility score + fix list, or vs-competitor comparison', 'Diagnostic report + score', 'content-edit', 'Layer 21/22'],
      ['claude-site-audit', 'seo-audit', 'SEO, accessibility, GEO & AI-readiness (15 checks)', 'client-ready PDF report with letter grade', 'Diagnostic report (client-facing PDF)', 'content-edit', 'Layer 21/22'],
      ['maquinable-geo', 'seo-audit', 'technical SEO + GEO issues incl. AI-bot robots.txt verdicts, /llms.txt', 'prioritized fix list', 'Diagnostic report', 'site-config', 'Layer 22 + Layers 26/27/29/69'],
      ['maquinable-geo', 'content-brief', 'SERP research for a keyword', 'content brief saved to file (EN/ES)', 'Content brief', 'content-edit', 'Layer 21'],
      ['maquinable-geo', 'geo-optimize', "a finished article's AI-quotability", 'TL;DR + FAQ + FAQPage JSON-LD added', 'Content addition + structured data', 'schema', 'Layer 21 (content) + Propose new Schema Layer (FAQPage JSON-LD)'],
      ['maquinable-geo', 'seo-gate', "a draft's pre-publish quality", '/100 score, auto-fix loop to 85+', 'Quality-gate score + auto-fix', 'content-edit', 'Layer 21'],
      ['aeo', 'aeo', 'AI-answer-engine optimization gaps', 'optimization recommendations (Hebrew/English)', 'Diagnostic + plan', 'content-edit', 'Layer 21/22'],
      ['aeo-brand-scan', 'scan', 'brand mentions across ChatGPT/Claude/Perplexity vs competitors', 'free AEO/GEO visibility score', 'Visibility score', 'monitoring', 'Propose new — AI-Search Monitoring Layer'],
      ['seo-geo-consultant', 'seo-geo-consultant', 'React/Next.js technical SEO+GEO issues (meta, schema, CWV, sitemaps)', 'implementation-ready fixes', 'Diagnostic + code-level fixes', 'content-edit', "N/A — framework-code focused, doesn't apply to this plugin's WP/API content model"],
    ],
  },
  {
    group: 'Search & Scrape Utilities',
    skills: [
      ['brightdata-plugin', 'scrape', 'any webpage, incl. bot-protected', 'clean Markdown', 'Raw scraped content', 'reporting', 'N/A — data-gathering only, feeds other layers'],
      ['brightdata-plugin', 'search', 'a Google query', 'structured JSON SERP results', 'Raw SERP dataset', 'reporting', 'N/A — data-gathering only'],
      ['brightdata-plugin', 'competitive-intel', "a competitor's site/social presence", 'competitive intelligence report', 'Competitive intelligence report', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['brightdata-plugin', 'seo-audit', 'scraped site data', 'SEO audit', 'Diagnostic report', 'content-edit', 'Layer 21/22'],
      ['brightdata-plugin', 'brand-listening', 'brand mentions across the web', 'sentiment / mentions report', 'Monitoring output', 'monitoring', 'Propose new — Brand/AI-Search Monitoring Layer'],
      ['brightdata-plugin', 'price-comparison', 'competitor pricing pages', 'price comparison table', 'Competitive pricing data', 'reporting', 'N/A — not applicable to quote-based B2B pricing'],
      ['brightdata-plugin', 'live-research', 'any live web-data need', 'research findings', 'Ad-hoc research findings', 'reporting', 'N/A — data-gathering only'],
      ['screenshotone', 'screenshot', 'a URL', 'screenshot or clean-markdown capture', 'Visual capture', 'reporting', 'N/A — data-gathering only'],
      ['serpapi', 'search', 'Google/Amazon/Walmart/YouTube + 100 engines', 'structured SERP dataset', 'Raw SERP dataset', 'reporting', 'N/A — data-gathering only'],
      ['search1api', 'search1api', 'a raw web query', 'search dataset', 'Raw search dataset', 'reporting', 'N/A — data-gathering only'],
      ['showly', 'showly-hosting', 'a site to preview/publish', 'published Showly site', 'Published preview site', 'new-build', "N/A — not applicable, sites aren't hosted on Showly"],
    ],
  },
  {
    group: 'Brand & Competitive Intelligence',
    skills: [
      ['content-intelligence', 'analyze', "a brand/topic's tracked data", 'analysis report', 'Competitive/brand analysis report', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['content-intelligence', 'compare', "two brands' tracked data", 'head-to-head comparison', 'Competitive comparison report', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['content-intelligence', 'discover', 'the market for untracked players', 'new brands/creators to add', 'Market discovery list', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['content-intelligence', 'research-analyst', 'competitor content performance', 'benchmarking insights', 'Benchmarking report', 'strategy', 'Propose new — Competitive Intelligence Layer'],
      ['content-intelligence', 'content-strategist', 'competitive creative data (hooks/formats/CTAs)', 'briefable creative direction', 'Creative direction brief', 'content-edit', 'Layer 21/60'],
      ['content-intelligence', 'weekly-brief', "a project's tracked scope", '3-page competitive-intelligence PDF', 'Monitoring/intelligence report', 'monitoring', 'Propose new — Competitive Intelligence Layer'],
      ['content-intelligence', 'tone-of-voice', "a brand's last 3 months of content", 'brand voice guide', 'Voice/config profile', 'content-edit', 'Layer 21 (feeds prompt/voice config)'],
      ['content-intelligence', 'audience-deep-dive', 'audience behavioral data', 'empathy canvas / insight brief', 'Strategic insight brief', 'strategy', 'N/A — strategic input, no direct layer'],
      ['content-intelligence', 'brand-marketing-mode', 'strategic marketing question', 'positioning / content-strategy read', 'Strategic positioning read', 'strategy', 'N/A — advisory only'],
    ],
  },
];

export interface AuditSkillDef {
  id: string;
  group: string;
  plugin: string;
  skill: string;
  finds: string;
  actionOutput: string;
  resultNature: string;
  implementationType: ImplementationType;
  actionType: ActionType;
  layerMappingRaw: string;
  layerNumbers: number[];
}

let cachedFlat: AuditSkillDef[] | null = null;

// Flattens the 10 grouped arrays above into the 140 skill definitions the
// AuditsService snapshots per run. id = `${plugin}:${skill}` — stable and
// unique even where the same skill name recurs under a different plugin
// (e.g. "seo-audit" exists under five different plugins).
export function getAllAuditSkills(): AuditSkillDef[] {
  if (cachedFlat) return cachedFlat;
  const out: AuditSkillDef[] = [];
  for (const g of AUDIT_SKILL_GROUPS) {
    for (const t of g.skills) {
      const [plugin, skill, finds, actionOutput, resultNature, implementationType, layerMappingRaw] = t;
      out.push({
        id: `${plugin}:${skill}`,
        group: g.group,
        plugin,
        skill,
        finds,
        actionOutput,
        resultNature,
        implementationType,
        actionType: IMPL_TO_ACTION[implementationType],
        layerMappingRaw,
        layerNumbers: parseLayerNumbers(layerMappingRaw),
      });
    }
  }
  cachedFlat = out;
  return out;
}

export function getAuditSkillCount(): number {
  return getAllAuditSkills().length;
}

// Skills this Engine can actually EXECUTE today with a live, free, no-API-
// key technical scan of the customer's own website (title/meta/H1/canonical/
// image-alt coverage/JSON-LD presence/sitemap.xml/robots.txt + AI-bot
// directives/llms.txt — see technical-analyzer.ts). Every other skill still
// becomes a real AuditTask row (per the user's "all 140 skills will be
// task" instruction) but is marked isAutomated=false with a finding that
// names the external data source (Semrush/Mangools/SE Ranking/GSC/etc.)
// its real execution is still pending — honest scaffolding, not a fake
// result. This mirrors the "pending_integration" status used for layer
// pushes until WP↔Engine auth is wired.
export const AUTOMATED_SKILL_IDS = new Set<string>([
  'seo-aeo-geo-ultimate:seo-technical',
  'seo-aeo-geo-ultimate:seo-sitemap',
  'seo-aeo-geo-ultimate:seo-images',
  'seo-aeo-geo-ultimate:seo-agentic',
  'seo-aeo-geo-ultimate:seo-schema',
  'seo-skills:seo-technical-audit',
  'seo-skills:seo-sitemap',
  'seo-skills:seo-images',
  'seo-skills:seo-schema',
  'searchfit-seo:seo-audit',
  'searchfit-seo:on-page-seo',
  'searchfit-seo:technical-seo',
  'searchfit-seo:schema-markup',
  'searchfit-seo:broken-links',
  'searchfit-seo:seo-check',
  'maquinable-geo:seo-audit',
  'claude-site-audit:seo-audit',
  'citable:ai-search-audit',
  'ubersuggest:seo-foundations',
  'ubersuggest:site-audit',
]);
