// The admin's to-do list for every customer and month cycle (Layer 3 > SEO Audit, admin side only).
// Order = the order the work is normally done in. `tool` names where in the Engine or outside it the task is done.

export interface CycleTaskDef {
  key: string;
  group: string;
  title: string;
  detail: string;
  tool: string;
}

export const CYCLE_TASKS: CycleTaskDef[] = [
  { key: 'run-audit', group: 'Audit', title: 'Run the SEO Audit for this cycle', detail: 'Layer 3 > SEO Audit > Run SEO Audit (admin only). Check that the run finished and the site was scanned (80+ pages, no failure reason).', tool: 'Engine' },
  { key: 'upload-evidence', group: 'Audit', title: 'Upload the tool evidence and press Complete', detail: 'AITDK, Digispot, PPCBlogPro, SEOquake, Mangools, SEOmator, Frase exports / screenshots in the evidence sections, then Complete; approve what was extracted.', tool: 'Engine' },
  { key: 'blogseo-dr', group: 'BlogSEO checks', title: 'Domain Rating: the customer and 5 competitors', detail: 'BlogSEO check_domain_rating (free). Note the numbers below and compare with the DR target for this month.', tool: 'BlogSEO' },
  { key: 'blogseo-density', group: 'BlogSEO checks', title: 'Keyword density: home page and 3 key pages', detail: 'BlogSEO check_keyword_density (free): ideal 0.5% to 2.5%, keyphrase in title, meta description, H1 and first 100 words. If the site blocks the fetcher (HTTP 403) pass the page text instead.', tool: 'BlogSEO' },
  { key: 'blogseo-score', group: 'BlogSEO checks', title: 'Content SEO score of the latest blog', detail: 'BlogSEO check_seo_score (needs an active BlogSEO plan). Note the 0-100 score and the top fixes.', tool: 'BlogSEO' },
  { key: 'competitors', group: 'BlogSEO checks', title: 'Refresh the competitor list', detail: 'Mangools / BlogSEO competitor lookup; keep real direct competitors (not generic content sites) for the DR comparison.', tool: 'Mangools' },
  { key: 'page-report', group: 'Fixes', title: 'Review the page-wise report and the root-domain table', detail: 'Layer 3 > SEO Audit > Page-wise report: check the pages to fix, duplicates, speed and schema rows.', tool: 'Engine' },
  { key: 'agent-ready', group: 'Fixes', title: 'Agent-readiness items (parameters 71-79)', detail: 'Content-Signal, real 404, business schema, sameAs, about / contact / legal links, llms.txt, Markdown, WebMCP, MCP Server Card: list what to fix on the website.', tool: 'Engine' },
  { key: 'push-fixes', group: 'Fixes', title: 'Push the fixes into the SEO report and to the website team', detail: 'Send the fix list (CSV or report) to whoever edits the website and note the date sent.', tool: 'Engine' },
  { key: "bing-sitemap", group: "Visibility & tracking", title: "Submit the sitemap to Bing Webmaster Tools", detail: "Bing Webmaster Tools > Sitemaps: submit sitemap.xml (also feeds ChatGPT search and Copilot). Check it is accepted with no errors and note the date submitted.", tool: "Bing Webmaster" },
  { key: "striking-distance", group: "Visibility & tracking", title: "Striking Distance analysis", detail: "Search Console: queries and pages at positions 8-20 with good impressions. List the top 10 pages to push (title, content, internal links) and add them to this month's fixes.", tool: "Search Console" },
  { key: "ai-roadmap", group: "Visibility & tracking", title: "Set the AI Visibility Roadmap for this customer", detail: "Place this month's actions on the right phase of the 6-month AI Visibility Roadmap (Strategy > AI Visibility Roadmap). Note the current phase.", tool: "Engine" },
  { key: "ai-prompt-tracker", group: "Visibility & tracking", title: "AI Visibility Prompt Tracker", detail: "Run the customer's fixed prompt set (Strategy > Prompt library) on ChatGPT, Perplexity, Gemini and AI Overviews. Record mentions, citations and the competitors named, same prompts every month.", tool: "Mangools AI Search Watcher" },
  { key: "location-tracker", group: "Visibility & tracking", title: "Location page ranking tracker", detail: "Check the rank of each location / service-area page for its main keyword (SERP and Maps where relevant). Note position changes against last month.", tool: "Mangools SERP Watcher" },
  { key: 'da-dr', group: 'Strategy', title: 'Record the measured DA (Moz) and DR (Ahrefs)', detail: 'Compare with this month’s internal target (Strategy > DA / DR target plan). Note behind, on track or ahead.', tool: 'Engine' },
  { key: 'strategy', group: 'Strategy', title: 'Generate, edit and approve the monthly Strategy', detail: 'Package > Generate strategy draft > edit > Approve strategy.', tool: 'Engine' },
  { key: 'signoff', group: 'Strategy', title: 'Admin sign-off and compile the customer package', detail: 'Tick the sign-off, press Compile, check the preview the customer will see.', tool: 'Engine' },
];
