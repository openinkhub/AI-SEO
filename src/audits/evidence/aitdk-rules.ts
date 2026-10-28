// Extraction rules for AITDK SEO Extension screenshots. Each rule names a screenshot type, how to
// recognise it, and the exact fields to read. The text goes to the vision model as its instructions;
// the field names are what the report renderer reads back (evidence-render.ts).
//
// Adding another tool/screen = add one entry here and one renderer case. Unknown screens are kept as
// a generic label/value list so nothing is lost.

export interface EvidenceRule {
  type: string;
  tool: string;
  label: string;
  recognise: string;
  fields: string;
}

export const EVIDENCE_RULES: EvidenceRule[] = [
  {
    type: 'aitdk_meta',
    tool: 'aitdk',
    label: 'Page meta (Title / Description / Keywords)',
    recognise: 'Cards titled Title, Description, Keywords with x/y counters, then URL and Canonical.',
    fields:
      '{"title":str,"titleLength":int,"titleLimit":int,"description":str,"descriptionLength":int,"descriptionLimit":int,"keywords":str,"keywordsLength":int,"keywordsLimit":int,"url":str,"canonical":str}  (lengths = the left number of each "56/60" badge, limits = the right number)',
  },
  {
    type: 'aitdk_technical',
    tool: 'aitdk',
    label: 'Technical overview',
    recognise: 'Domain Creation/Expiration, Robots Tag, robots.txt, sitemap.xml, Google Analytics/AdSense, Word Count, Lang, H1-H6 counts, Images and Links tables.',
    fields:
      '{"domainCreation":str,"domainExpiration":str,"robotsTag":str,"xRobotsTag":str,"robotsTxt":"Available|Missing","sitemapXml":"Available|Missing","googleAnalytics":"Available|Missing","googleAdsense":"Available|Missing","ssrCheck":str|null,"wordCount":int,"lang":str,"headings":{"h1":int,"h2":int,"h3":int,"h4":int,"h5":int,"h6":int},"images":{"total":int,"unique":int,"withoutAlt":int,"withoutTitle":int},"links":{"total":int,"unique":int,"internal":int,"external":int,"dofollow":int,"nofollow":int}}',
  },
  {
    type: 'aitdk_traffic',
    tool: 'aitdk',
    label: 'Traffic overview',
    recognise: 'Left menu item Traffic selected; Traffic Overview grid (Monthly Visits, Bounce Rate, Pages Per Visit...) and Visits Over Time chart.',
    fields:
      '{"period":str,"monthlyVisits":str,"bounceRate":str,"pagesPerVisit":str,"visitDuration":str,"globalRank":str,"countryRank":str,"domainCreation":str,"domainExpiration":str,"domainAge":str}  (keep values exactly as shown, e.g. "N/A")',
  },
  {
    type: 'aitdk_backlinks',
    tool: 'aitdk',
    label: 'Backlinks',
    recognise: 'Left menu item Backlinks selected; Domain Rating, Backlinks, Ref. Domains and a Top Backlinks list.',
    fields:
      '{"domainRating":int,"backlinks":int,"refDomains":int,"dofollowPercent":int|null,"topBacklinks":[{"domain":str,"dr":int|null,"title":str|null,"sourceUrl":str|null,"targetUrl":str|null}]}  (only list the backlinks visible in the image)',
  },
  {
    type: 'aitdk_geo_section',
    tool: 'aitdk',
    label: 'GEO / AI-readiness section (Structured Data, Content & Citability, Trust & E-E-A-T)',
    recognise: 'A card with a heading and a score badge on the right, then a list of checks with a green tick or an orange warning icon, each with a one-line description.',
    fields:
      '{"section":str,"score":int,"items":[{"name":str,"status":"pass|warn","note":str}]}  (tick = pass, orange exclamation = warn)',
  },
  {
    type: 'aitdk_serp',
    tool: 'aitdk',
    label: 'SERP / indexed pages',
    recognise: 'Left menu item SERP selected; "Number Of Indexed Pages" per search engine and a Google Search Results Preview.',
    fields:
      '{"indexedPages":{"google":int|null,"bing":int|null,"yahoo":int|null,"baidu":int|null,"yandex":int|null,"duckduckgo":int|null,"ask":int|null,"aol":int|null,"naver":int|null,"qwant":int|null,"sogou":int|null,"brave":int|null},"preview":{"site":str,"url":str,"title":str,"description":str}}  (an icon instead of a number = null)',
  },
  {
    type: 'aitdk_density',
    tool: 'aitdk',
    label: 'Keyword density',
    recognise: 'Left menu item Density selected; tabs 1 word / 2 words ... with counts and a Keyword / Found in / Count / Density table.',
    fields:
      '{"totalWords":int,"ngramCounts":{"1":int,"2":int,"3":int,"4":int,"5":int},"activeTab":int,"rows":[{"keyword":str,"foundIn":[str],"count":int,"density":str}]}  (foundIn letters T=title, D=description, H1)',
  },
  {
    type: 'aitdk_social',
    tool: 'aitdk',
    label: 'Social meta (Open Graph / Twitter Card)',
    recognise: 'Left menu item Social selected; Open Graph and Twitter Card tables of og:* / twitter:* tags.',
    fields: '{"openGraph":{"<tag>":str},"twitterCard":{"<tag>":str}}  (use the tag name as the key, e.g. "og:title"; empty cells = "")',
  },
  {
    type: 'aitdk_structured_data',
    tool: 'aitdk',
    label: 'Structured data (JSON-LD)',
    recognise: 'Left menu item Structured selected; a Key / Value table of JSON-LD (@context, @graph, @type ...).',
    fields:
      '{"schemaTypes":[str],"entries":[{"key":str,"value":str}],"datePublished":str|null,"dateModified":str|null}  (entries = visible rows in order; schemaTypes = every @type value seen)',
  },
  {
    type: 'ppcblogpro_summary',
    tool: 'ppcblogpro',
    label: 'Page score (SEO / AEO / GEO)',
    recognise: 'PPCBlogPro result: a big Total score ring (e.g. 66/100) with a label such as "Needs polish", three bars SEO / AEO / GEO, and a PAGE STATS table (Title, Type, Words, Headings, Images, Links, Scope, Schema).',
    fields:
      '{"verdict":str,"verdictText":str,"total":int,"seo":int,"aeo":int,"geo":int,"page":{"title":str,"type":str,"words":int,"headings":str,"images":str,"links":str,"scope":str,"schema":[str]}}  (verdict = bold heading e.g. "Needs polish"; headings/images/links copied as shown, e.g. "H1 1 | H2 11 | H3 18")',
  },
  {
    type: 'seoanalyzer_summary',
    tool: 'seoanalyzer',
    label: 'SEO Analyzer - Page summary',
    recognise: 'Popup titled "SEO Analyzer" with tabs Summary / Headers / Images / Links / Social / Tools, the Summary tab selected, showing "Page Summary" with Title, Description (with character counts), Keywords, URL, Canonical, Robots Tag, Author, Publisher, Language.',
    fields:
      '{"title":str,"titleLength":int,"description":str,"descriptionLength":int,"keywords":str,"url":str,"canonical":str,"robotsTag":str,"author":str,"publisher":str,"lang":str}  (author/publisher: copy the text shown, e.g. "Author is missing."; lengths = the "56 characters" style numbers)',
  },
  {
    type: 'seoanalyzer_tab',
    tool: 'seoanalyzer',
    label: 'SEO Analyzer - other tab',
    recognise: 'Same SEO Analyzer popup but the Headers, Images, Links, Social or Tools tab is selected.',
    fields:
      '{"tab":str,"items":[{"label":str,"value":str}]}  (tab = selected tab name; items = every visible row/heading/link count in order, one label/value pair each)',
  },
];

export function buildExtractionPrompt(): string {
  const catalog = EVIDENCE_RULES.map(
    (r) => `- type "${r.type}" (${r.label}): ${r.recognise}\n  data shape: ${r.fields}`,
  ).join('\n');
  return [
    'You read a screenshot taken from an SEO browser extension and return its data as JSON.',
    'Pick exactly one type from the list below, then fill that type\'s data shape from what is visible.',
    'Rules: copy numbers and text exactly as shown; never guess or invent a value - use null (or omit the item) for anything not visible; ignore ads, banners and menus.',
    'If the screenshot matches none of the types, use type "unknown" with data {"title":str,"items":[{"label":str,"value":str}]}.',
    'Reply with ONE JSON object only, no prose, no code fences: {"type":"<type>","data":{...}}',
    '',
    'Types:',
    catalog,
  ].join('\n');
}

export const KNOWN_TYPES = new Set(EVIDENCE_RULES.map((r) => r.type).concat(['digispot_report', 'ppcblogpro_report', 'unknown']));
