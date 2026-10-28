// Customer-specific APIs. This mirrors the WP plugin's KP21_Customer_API::services() (the "Customer
// API Configuration" panel in the WP Admin customer profile), plus Google PageSpeed which the Engine
// SEO Audit uses directly. Add a provider here and it appears in the admin Layer 2 card and the
// all-customers list automatically.

export interface ApiField {
  name: string;
  label: string;
  secret: boolean; // secrets are encrypted and shown masked (last 4 only)
  optional?: boolean; // not needed for the API to count as "configured"
  number?: boolean;
  multiline?: boolean;
  placeholder?: string;
}

export interface ApiProvider {
  key: string;
  label: string;
  group: string;
  description: string;
  fields: ApiField[];
  usedBy: string;
  testable: boolean; // a live test call is implemented
  wired: boolean; // the Engine SEO Audit already uses it today
  anyOf?: boolean; // configured when at least one field is filled (no single required field)
  oneOfSets?: string[][]; // configured when every field of at least one set is filled (instead of per-field required)
  required?: boolean; // must be configured before the customer SEO package can be compiled
}

const key = (label = 'API key'): ApiField => ({ name: 'apiKey', label, secret: true });

// The 8 Layer 20 (Blog 3.0) destination sites - same list as the WP plugin.
const LAYER20_SITES: Array<[string, string, string]> = [
  ['nexorapress', 'Nexorapress', 'https://nexorapress.blog/'],
  ['primenarrative', 'Primenarrative', 'https://primenarrative.blog/'],
  ['startupstack', 'Startupstack', 'https://startupstack.blog/'],
  ['beyondmetrics', 'Beyondmetrics', 'https://beyondmetrics.blog/'],
  ['nextreach', 'Nextreach', 'https://nextreach.blog/'],
  ['growthscript', 'Growthscript', 'https://growthscript.blog/'],
  ['signalloom', 'Signalloom', 'https://signalloom.blog/'],
  ['openinkhub', 'Openinkhub', 'https://openinkhub.blog/'],
];

export const API_PROVIDERS: ApiProvider[] = [
  {
    key: 'serpapi', label: 'SerpApi', group: 'Research & SERP data',
    description: 'Google AI Mode / PAA / SERP evidence.',
    fields: [key(), { name: 'monthlyLimit', label: 'Monthly search limit', secret: false, number: true, optional: true }],
    usedBy: 'Layers 4-10 research, Layer 7 PAA, Layer 11 Google volume / SERP evidence.', testable: true, wired: false, required: true,
  },
  {
    key: 'scrapedo', label: 'Scrape.do', group: 'Research & SERP data',
    description: 'Fallback when SerpApi is unavailable or exhausted.',
    fields: [
      { name: 'apiKey', label: 'Token', secret: true },
      { name: 'monthlyLimit', label: 'Monthly credit limit', secret: false, number: true, optional: true },
      { name: 'creditsPerCall', label: 'Credits per call', secret: false, number: true, optional: true },
    ],
    usedBy: 'SERP fallback for the research layers.', testable: false, wired: false,
  },
  {
    key: 'keywords_everywhere', label: 'Keywords Everywhere', group: 'Research & SERP data',
    description: 'Competitor keyword research.',
    fields: [key()], usedBy: 'Layer 11-AA competitor keywords.', testable: true, wired: false,
  },
  {
    key: 'mangools', label: 'Mangools / KWFinder', group: 'Research & SERP data',
    description: 'Search volume, difficulty, CPC and trend validation; SiteProfiler / LinkMiner / AI Search Watcher.',
    fields: [
      key('REST API key'),
      { name: 'locationId', label: 'KWFinder location ID', secret: false, number: true, optional: true },
      { name: 'languageId', label: 'KWFinder language ID', secret: false, number: true, optional: true },
      { name: 'mgSpOverview', label: 'SiteProfiler authority overview (0 = off, blank = on)', secret: false, number: true, optional: true },
      { name: 'mgSpBacklinks', label: 'SiteProfiler backlink profile: max rows (0 = off, blank = 10)', secret: false, number: true, optional: true },
      { name: 'mgSpCompetitors', label: 'SiteProfiler competitors: max rows (0 = off, blank = 10)', secret: false, number: true, optional: true },
      { name: 'mgSpTopContent', label: 'SiteProfiler top content: max rows (0 = off, blank = 10)', secret: false, number: true, optional: true },
      { name: 'mgLinkMiner', label: 'LinkMiner URL metrics: max URLs (0 = off, blank = 1 homepage)', secret: false, number: true, optional: true },
      { name: 'mgAiWatcher', label: 'AI Search Watcher: max rows (0 = off, blank = 8)', secret: false, number: true, optional: true },
    ],
    usedBy: 'SEO Audit (automatic, each function separately): SiteProfiler overview / backlinks / competitors / top content, LinkMiner, AI Search Watcher. Layer 11-12 keyword validation.', testable: true, wired: true, required: true,
  },
  {
    key: 'ahrefs', label: 'Ahrefs (free Domain Rating)', group: 'Research & SERP data',
    description: 'Free Domain Rating API (Ahrefs API v3 key from Account settings > API keys). Shows the site’s Domain Rating next to its competitors. Credit: Domain Rating by Ahrefs.',
    fields: [
      key('API v3 key'),
      { name: 'ahDomainRating', label: 'Domain Rating card (0 = off, blank = on)', secret: false, number: true, optional: true },
      { name: 'ahDrCompetitors', label: 'Competitors to compare: max (0 = none, blank = 5)', secret: false, number: true, optional: true },
    ],
    usedBy: 'SEO Audit (automatic): Domain Rating of the site and its named competitors; feeds the authority and competitor tasks.', testable: true, wired: true,
  },
  {
    key: 'geekflare', label: 'Geekflare', group: 'Site analysis',
    description: 'Competitor-page extraction, Lighthouse and technical checks.',
    fields: [key()], usedBy: 'Layer 12 competitor extraction, Layer 13 content-gap evidence, technical / Core Web Vitals checks.', testable: false, wired: false,
  },
  {
    key: 'screenshotone', label: 'ScreenshotOne', group: 'Site analysis',
    description: 'Real competitor homepage screenshots.',
    fields: [key('Access key')], usedBy: 'Layer 194 web-mockup competitor analysis.', testable: false, wired: false,
  },
  {
    key: 'browserless', label: 'Browserless', group: 'Site analysis',
    description: 'Renders JavaScript-only (SPA) customer sites so real pages and menu names can be found.',
    fields: [key('API key (token)'), { name: 'endpoint', label: 'Region endpoint (optional, blank = default)', secret: false, optional: true, placeholder: 'https://production-sfo.browserless.io' }],
    usedBy: 'Page Image Library fetch on SPA sites.', testable: false, wired: false,
  },
  {
    key: 'pagespeed', label: 'Google PageSpeed Insights', group: 'Site analysis',
    description: 'Lighthouse scores and Core Web Vitals for the customer’s site.',
    fields: [key()], usedBy: 'Added automatically to every SEO Audit run.', testable: true, wired: true, required: true,
  },
  {
    key: 'google_ids', label: 'Google properties (common account)', group: 'Google',
    description: 'No per-customer password. GSC / GA4 / GTM / GAM use the common Google account openink.in@gmail.com; the customer must add that account as Manager / User, and the property IDs below tell the Engine which property to read.',
    fields: [
      { name: 'gscProperty', label: 'Search Console property URL', secret: false, optional: true, placeholder: 'https://example.com/' },
      { name: 'ga4Property', label: 'GA4 property ID (numbers)', secret: false, optional: true, placeholder: '123456789' },
      { name: 'gtmContainer', label: 'GTM container ID', secret: false, optional: true, placeholder: 'GTM-ABC1234' },
      { name: 'gamNetwork', label: 'Google Ad Manager network code', secret: false, optional: true, placeholder: '12345678' },
    ],
    usedBy: 'GSC / GA4 / GTM / GAM skills (same common-account model as the WP plugin).', testable: false, wired: false, anyOf: true,
  },
  {
    key: 'layer23_website_blog', label: 'Website Blog Post (Layer 23) - own site', group: 'Publishing',
    description: 'The customer’s own Blog Publish API: POST to the endpoint with an X-API-Key header and a JSON body.',
    fields: [
      { name: 'endpointUrl', label: 'Blog Publish API endpoint URL', secret: false },
      key(),
      { name: 'author', label: 'Author name sent to the Blog API', secret: false, optional: true },
      { name: 'responseUrlField', label: 'Response URL field path (optional, blank = auto-detect)', secret: false, optional: true, placeholder: 'url or data.post.link' },
    ],
    usedBy: 'Layer 23 daily automated publishing.', testable: false, wired: false,
  },
  ...LAYER20_SITES.map(
    ([k, label, url]): ApiProvider => ({
      key: `layer20_${k}`, label: `${label} (Layer 20)`, group: 'Blog 3.0 destinations',
      description: `WordPress REST API publishing to ${url}`,
      fields: [{ name: 'username', label: 'WordPress username', secret: false }, { name: 'appPassword', label: 'WordPress application password', secret: true }],
      usedBy: 'Layer 20 Blog 3.0 automated publishing.', testable: false, wired: false,
    }),
  ),
];

export const PROVIDER_KEYS = new Set(API_PROVIDERS.map((p) => p.key));
export const findProvider = (k: string): ApiProvider | undefined => API_PROVIDERS.find((p) => p.key === k);

// Retired in the WP plugin (v8.9.142): dataforseo, ranksorcery (RankSorcery needs no key).

export function isComplete(p: ApiProvider, vals: Record<string, string> | null): boolean {
  if (!vals) return false;
  if (p.oneOfSets) return p.oneOfSets.some((set) => set.every((n) => !!vals[n]));
  if (p.anyOf) return p.fields.some((f) => !!vals[f.name]);
  return p.fields.filter((f) => !f.optional).every((f) => !!vals[f.name]);
}

// Global (admin-wide) APIs: one key set for the whole Engine, not per customer. Configured in Global API Settings.
export const GLOBAL_API_PROVIDERS: ApiProvider[] = [
  {
    key: 'moz', label: 'Moz Links API', group: 'Authority metrics',
    description: 'Moz Domain Authority, Page Authority and Spam Score (Moz Links API v2: either an API token (x-moz-token header) or Access ID + Secret Key (Basic auth), from your Moz API account).',
    fields: [
      { name: 'apiToken', label: 'API token (x-moz-token) - use this OR Access ID + Secret Key', secret: true, optional: true },
      { name: 'accessId', label: 'Access ID', secret: false, optional: true },
      { name: 'secretKey', label: 'Secret Key', secret: true, optional: true },
      { name: 'mzAuthority', label: 'Domain Authority card (0 = off, blank = on)', secret: false, number: true, optional: true },
      { name: 'mzCompetitors', label: 'Competitors to compare: max (0 = none, blank = 5)', secret: false, number: true, optional: true },
    ],
    usedBy: 'SEO Audit (automatic, every customer): Domain Authority of the site and its named competitors; feeds the authority and competitor tasks. Target: Domain Authority 60+.', testable: true, wired: true,
    oneOfSets: [['apiToken'], ['accessId', 'secretKey']],
  },
  ...(
    [
      ['openai', 'ChatGPT / OpenAI', 'gpt-4o'],
      ['gemini', 'Gemini', 'gemini-2.5-flash'],
      ['perplexity', 'Perplexity', 'sonar'],
      ['anthropic', 'Claude / Anthropic', 'claude-sonnet-4-5'],
      ['xai', 'Grok / xAI', 'grok-4'],
      ['deepseek', 'DeepSeek', 'deepseek-chat'],
      ['openrouter', 'OpenRouter (Meta AI fallback)', 'meta-llama/llama-3.3-70b-instruct'],
    ] as Array<[string, string, string]>
  ).map(
    ([k, label, model]): ApiProvider => ({
      key: k, label, group: 'AI platforms',
      description: `${label} API key for the AI research Layers (one key for all customers). Leave the model blank to use ${model}.`,
      fields: [key(), { name: 'model', label: `Model (blank = ${model})`, secret: false, optional: true }],
      usedBy: 'Layer 4 AI Search Keyword (and the other AI research Layers as they are built).', testable: true, wired: true,
    }),
  ),
];
export const findGlobalProvider = (k: string): ApiProvider | undefined => GLOBAL_API_PROVIDERS.find((p) => p.key === k);
