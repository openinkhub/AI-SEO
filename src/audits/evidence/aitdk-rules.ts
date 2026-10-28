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
  {
    type: 'seoquake_audit',
    tool: 'seoquake',
    label: 'SEOquake On-Page SEO Audit',
    recognise: 'PDF titled "On-Page SEO Audit Report" with Passed / Error / Warning counts, then Page Analysis, Mobile Compliance, Technical Compliance, Document Info, Heading Structure, Image Analysis and Schema Summary sections.',
    fields:
      '{"date":str,"counts":{"passed":int,"errors":int,"warnings":int},"checks":[{"group":"Page Analysis|Mobile Compliance|Technical Compliance|Other","name":str,"status":"pass|warning|error","value":str,"detail":str}],"headings":[{"level":int,"text":str}],"images":{"total":int,"withAlt":int,"missingAlt":int,"oversized":int,"formats":[str]},"schemaTypes":[str]}  (one check per row, e.g. {"name":"Meta Description","status":"warning","value":"166 CHARS","detail":"the advice/finding text"}; value = the badge on the right; status: green/passed = pass, amber = warning, red/pending/failed = error; headings in page order)',
  },
  {
    type: 'mangools_siteprofiler',
    tool: 'mangools',
    label: 'Mangools SiteProfiler (backlinks & authority)',
    recognise: 'PDF printed from app.mangools.com/siteprofiler: domain header, Domain Authority / Page Authority / Citation Flow / Trust Flow gauges, Backlink profile, Referring domains, Anchor texts, Top content, Competitors.',
    fields:
      '{"domain":str,"authority":{"domainAuthority":int,"pageAuthority":int,"citationFlow":int,"trustFlow":int},"referringIps":int|null,"backlinks":{"active":int,"lost":int,"total":int,"totalChangePercent":str|null,"dofollowRatio":str|null,"activeRatio":str|null},"referring":{"domains":int,"ips":int,"subnets":int},"anchorTypeDistribution":str|null,"topReferringDomains":[{"domain":str,"cf":int,"tf":int,"links":int,"wpr":int}],"anchors":[{"text":str,"type":str,"rd":int,"total":int,"share":str}],"topContent":[{"url":str,"fb":str,"rd":int}],"competitors":[{"url":str,"wpr":str,"ri":str,"fb":str,"sk":str}]}  (N/A stays "N/A"; domain names cut off in the printout are copied as shown)',
  },
  {
    type: 'frase_ai_visibility',
    tool: 'frase',
    label: 'Frase - AI visibility check',
    recognise: 'Frase "Are AI engines citing your domain?" free AI visibility tool result: a card saying whether an AI engine (e.g. ChatGPT) cited the domain for a test question.',
    fields:
      '{"engine":str,"question":str,"cited":bool,"domain":str,"note":str}  (cited = false when the card says the engine "didn\'t cite" the domain; note = the small grey sentence under it, if any)',
  },
  {
    type: 'seomator_geo_audit',
    tool: 'seomator',
    label: 'SEOmator GEO Audit',
    recognise: 'PDF titled "SEOmator - GEO Audit Report" with a GEO Readiness Score /100, Executive Summary, GEO Score Breakdown, AI Platform Readiness, Key Metrics, E-E-A-T Analysis, AI Crawler Access, Key Findings, Technical Findings, Brand Recommendations.',
    fields:
      '{"score":int,"grade":str,"businessType":str,"pagesAnalyzed":int,"date":str,"summary":str,"priorityActions":[str],"categories":[{"name":str,"weight":str,"score":int,"grade":str}],"platforms":[{"name":str,"score":int,"readiness":str}],"metrics":[{"label":str,"value":str}],"eeat":[{"pillar":str,"score":int,"max":int,"evidence":str}],"crawlers":{"checked":int,"allowed":int,"blocked":int,"notMentioned":int,"blockedNames":[str]},"findings":[{"severity":"critical|high|medium|low","title":str,"description":str,"effort":str}],"technicalIssues":[{"severity":str,"issue":str,"page":str}],"brandRecommendations":[str],"schemaTypes":[str]}  (summary = executive summary text without markdown asterisks, max ~600 chars; priorityActions = the numbered list; findings = every row of Key Findings; technicalIssues = rows of Technical Findings, max 30; copy numbers exactly)',
  },
  {
    type: 'digispot_dashboard',
    tool: 'digispot',
    label: 'Digispot AI - audit dashboard scores',
    recognise: 'Screenshot of app.digispot.ai audit results: gauges (Site Architecture Score, Page Score, Robots.txt / Sitemap / Security score), "Impact Levels" tiles (Low / Medium / High / Critical counts), and "Page Audit Insights" cards each with a score /100, a label (EXCELLENT / GOOD / FAIR / POOR) and a Min / Avg / Max bar.',
    fields:
      '{"impact":{"low":int,"medium":int,"high":int,"critical":int}|null,"scores":[{"group":str,"name":str,"score":int|null,"label":str|null,"min":int|null,"avg":int|null,"max":int|null,"top10":int|null}]}  (one scores row per card/gauge visible; group = the section heading above it, e.g. "Site Architecture", "Crawlability", "Content and Markup Quality", "Performance Optimization", "Links", "Visual and Media Optimization", "Branding and Engagement", "Personalization and Market Reach"; top10 = the "Top-10%: 90" number when shown; "Coming Soon"/"N/A" cards: score null and label as shown; impact = null when the tiles are not in the screenshot)',
  },
];

export function buildExtractionPrompt(tool?: string | null): string {
  const pool = tool && EVIDENCE_RULES.some((r) => r.tool === tool) ? EVIDENCE_RULES.filter((r) => r.tool === tool) : EVIDENCE_RULES;
  const catalog = pool.map(
    (r) => `- type "${r.type}" (${r.label}): ${r.recognise}\n  data shape: ${r.fields}`,
  ).join('\n');
  return [
    'You read a screenshot or PDF exported from an SEO tool and return its data as JSON.',
    'Pick exactly one type from the list below, then fill that type\'s data shape from what is visible.',
    'Rules: copy numbers and text exactly as shown; never guess or invent a value - use null (or omit the item) for anything not visible; ignore ads, banners and menus.',
    'If the screenshot matches none of the types, use type "unknown" with data {"title":str,"items":[{"label":str,"value":str}]}.',
    'Reply with ONE JSON object only, no prose, no code fences: {"type":"<type>","data":{...}}',
    '',
    'Types:',
    catalog,
  ].join('\n');
}

export const KNOWN_TYPES = new Set(EVIDENCE_RULES.map((r) => r.type).concat(['digispot_report', 'ppcblogpro_report', 'pagespeed_report', 'unknown']));

// Upload sections shown in the admin panel (one box per tool). Add a line here when a new tool arrives.
export const TOOL_SECTIONS: Array<{ key: string; label: string; accepts: string; hint: string }> = [
  { key: 'auto', label: 'Automatic (customer APIs)', accepts: '', hint: 'Filled by the audit run from the customer\'s API settings (Layer 2). Nothing to upload.' },
  { key: 'aitdk', label: 'AITDK SEO Extension', accepts: 'image/png,image/jpeg,image/webp', hint: 'Screenshots (Meta, Technical, Traffic, Backlinks, GEO, SERP, Density, Social, Structured)' },
  { key: 'digispot', label: 'Digispot AI - SEO Insights', accepts: '.txt,text/plain,image/png,image/jpeg,image/webp', hint: 'Comprehensive report .txt export and/or screenshots of the audit results dashboard' },
  { key: 'ppcblogpro', label: 'PPCBlogPro - SEO / AEO / GEO', accepts: '.csv,text/csv,image/png,image/jpeg,image/webp', hint: '.csv export and/or score screenshot' },
  { key: 'seoanalyzer', label: 'SEO Analyzer (extension)', accepts: 'image/png,image/jpeg,image/webp', hint: 'Screenshots of the Summary / Headers / Images / Links / Social / Tools tabs' },
  { key: 'seoquake', label: 'SEOquake', accepts: '.pdf,application/pdf', hint: 'On-Page SEO Audit PDF' },
  { key: 'mangools', label: 'Mangools SiteProfiler', accepts: '.pdf,application/pdf,image/png,image/jpeg,image/webp', hint: 'Backlinks / authority PDF or screenshots' },
  { key: 'seomator', label: 'SEOmator - GEO Audit', accepts: '.pdf,application/pdf', hint: 'GEO Audit Report PDF' },
  { key: 'frase', label: 'Frase - AI visibility', accepts: 'image/png,image/jpeg,image/webp', hint: 'Screenshot of the AI citation result' },
  { key: 'other', label: 'Other tool', accepts: 'image/png,image/jpeg,image/webp,.pdf,application/pdf,.txt,.csv', hint: 'Anything else - read as a generic label/value list' },
];
