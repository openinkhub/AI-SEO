// Rule-based parser for the "Digispot AI - SEO Insights" text export
// ("COMPREHENSIVE SEO ANALYSIS REPORT"). Plain text in, structured data out - no AI involved, so
// the result is deterministic. Each rule below is a label/regex over the report's fixed layout.
// A rule that finds nothing simply leaves its field out, so a layout change degrades gracefully.

export interface DigispotIssue {
  priority: 'critical' | 'important' | 'minor';
  category: string;
  title: string;
  impact: string | null;
  fix: string | null;
}

export interface DigispotReport {
  tool: 'digispot';
  pageUrl: string | null;
  generated: string | null;
  overallScore: number | null;
  overallLabel: string | null;
  categoryScores: Record<string, number>;
  issueCounts: { total: number | null; critical: number | null; important: number | null; minor: number | null };
  issues: DigispotIssue[];
  quickWins: string[];
  strengths: string[];
  // Key facts per report section, keyed by a stable id (metadata, headings, content, links, ...).
  sections: Record<string, Record<string, string | number | string[]>>;
  // Every "⚠" warning line, grouped by section id.
  warnings: Record<string, string[]>;
}

export function looksLikeDigispot(text: string): boolean {
  return /COMPREHENSIVE SEO ANALYSIS REPORT/i.test(text) || /Digispot AI/i.test(text);
}

const SECTION_IDS: Array<[RegExp, string]> = [
  [/ON-PAGE METADATA/i, 'metadata'],
  [/HEADING STRUCTURE/i, 'headings'],
  [/CONTENT QUALITY/i, 'content'],
  [/INTERNAL & EXTERNAL LINKS/i, 'links'],
  [/IMAGE OPTIMIZATION/i, 'images'],
  [/VIDEO ELEMENTS/i, 'video'],
  [/STRUCTURED DATA/i, 'schema'],
  [/SOCIAL MEDIA/i, 'social'],
  [/LOCAL SEO/i, 'local'],
  [/PAGE PERFORMANCE/i, 'performance'],
];

function clean(s: string): string {
  return s.replace(/\r/g, '');
}

// Value after "Label:" on the same line (first match in the block).
function kv(block: string, label: string): string | null {
  const re = new RegExp(`^[ \\t]*${label}:[ \\t]*(.+?)[ \\t]*$`, 'mi');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Text between two markers (start inclusive of nothing, end exclusive).
function between(text: string, startRe: RegExp, endRe: RegExp): string {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s);
  const e = rest.slice(1).search(endRe);
  return e < 0 ? rest : rest.slice(0, e + 1);
}

function parseIssues(text: string): DigispotIssue[] {
  const out: DigispotIssue[] = [];
  const groups: Array<[RegExp, DigispotIssue['priority']]> = [
    [/MUST FIX \(Critical\)/i, 'critical'],
    [/SHOULD FIX \(Important\)/i, 'important'],
    [/NICE TO HAVE \(Minor\)/i, 'minor'],
  ];
  for (const [re, priority] of groups) {
    const block = between(text, re, /\n┌─|\n═{10,}/);
    if (!block) continue;
    const lines = block.split('\n');
    let cur: DigispotIssue | null = null;
    for (const line of lines) {
      const head = line.match(/^\s*\d+\.\s*\[([^\]]+)\]\s*(.+?)\s*$/);
      if (head) {
        cur = { priority, category: head[1].trim(), title: head[2].trim(), impact: null, fix: null };
        out.push(cur);
        continue;
      }
      if (!cur) continue;
      const imp = line.match(/^\s*Impact:\s*(.+?)\s*$/i);
      if (imp) cur.impact = imp[1];
      const fix = line.match(/^\s*Fix:\s*(.+?)\s*$/i);
      if (fix) cur.fix = fix[1];
    }
  }
  return out;
}

function parseHeadings(block: string): Record<string, string | number | string[]> {
  const o: Record<string, string | number | string[]> = {};
  const line = kv(block, 'Heading Structure');
  if (line) {
    for (const m of line.matchAll(/H([1-6])\((\d+)\)/g)) o[`h${m[1]}`] = Number(m[2]);
  }
  const total = num(kv(block, 'Total Headings'));
  if (total != null) o.total = total;
  const valid = kv(block, 'Valid Hierarchy');
  if (valid) o.validHierarchy = valid;
  const multi = kv(block, 'Multiple H1s');
  if (multi) o.multipleH1 = multi;
  const h1 = kv(block, 'Primary H1');
  if (h1) o.primaryH1 = h1;
  return o;
}

function pick(block: string, map: Record<string, string>): Record<string, string | number | string[]> {
  const o: Record<string, string | number | string[]> = {};
  for (const [key, label] of Object.entries(map)) {
    const v = kv(block, label);
    if (v != null) o[key] = v;
  }
  return o;
}

export function parseDigispotReport(raw: string): DigispotReport {
  const text = clean(raw);
  const report: DigispotReport = {
    tool: 'digispot',
    pageUrl: null,
    generated: null,
    overallScore: null,
    overallLabel: null,
    categoryScores: {},
    issueCounts: { total: null, critical: null, important: null, minor: null },
    issues: [],
    quickWins: [],
    strengths: [],
    sections: {},
    warnings: {},
  };

  const url = text.match(/Page URL:\s*(\S+)/i);
  if (url) report.pageUrl = url[1];
  const gen = text.match(/Generated:\s*(.+?)\s*(?:║|$)/im);
  if (gen) report.generated = gen[1].trim();

  const overall = text.match(/OVERALL SCORE:\s*(\d+)\s*\/\s*100\s*\(([^)]+)\)/i);
  if (overall) {
    report.overallScore = Number(overall[1]);
    report.overallLabel = overall[2].trim();
  }
  const catBlock = between(text, /CATEGORY SCORES:/i, /╚/);
  for (const m of catBlock.matchAll(/(Indexability|Content|Headings|Media|Links|Schema|Social|Local SEO|Performance)\s*:\s*(\d+)\s*\/\s*100/g)) {
    report.categoryScores[m[1]] = Number(m[2]);
  }

  report.issueCounts = {
    total: num((text.match(/Total Issues Found:\s*(\d+)/i) ?? [])[1] ?? null),
    critical: num((text.match(/Critical \(Must Fix\):\s*(\d+)/i) ?? [])[1] ?? null),
    important: num((text.match(/Important \(Should Fix\):\s*(\d+)/i) ?? [])[1] ?? null),
    minor: num((text.match(/Minor \(Nice to Have\):\s*(\d+)/i) ?? [])[1] ?? null),
  };
  report.issues = parseIssues(text);

  const qw = between(text, /QUICK WINS/i, /\n┌─|\n═{10,}/);
  for (const line of qw.split('\n')) {
    const m = line.match(/^\s*→\s*(.+?)\s*$/);
    if (m) report.quickWins.push(m[1]);
  }
  const st = between(text, /STRENGTHS/i, /\n┌─|\n═{10,}/);
  for (const line of st.split('\n')) {
    const m = line.match(/^\s*✓\s*(.+?)\s*$/);
    if (m) report.strengths.push(m[1]);
  }

  // Split into numbered sections.
  const parts = text.split(/^SECTION \d+:\s*(.+)$/m);
  // parts = [preamble, title1, body1, title2, body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i];
    const body = (parts[i + 1] ?? '').replace(/^═+$/gm, '');
    const hit = SECTION_IDS.find(([re]) => re.test(title));
    if (!hit) continue;
    const id = hit[1];
    const warns = body
      .split('\n')
      .map((l) => l.match(/^\s*⚠\s*(.+?)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => m[1]);
    if (warns.length) report.warnings[id] = warns;

    switch (id) {
      case 'metadata': {
        const s = pick(body, {
          title: 'Title',
          metaDescription: 'Meta Description',
          canonical: 'Canonical URL',
          language: 'Language',
          charset: 'Character Set',
          viewport: 'Viewport',
          technologies: 'Technologies',
          analytics: 'Analytics',
          scripts: 'Scripts',
          pageHtmlSize: 'Page HTML Size',
          robotsTxt: 'Robots.txt Status',
          xRobotsTag: 'X-Robots-Tag',
          llmsTxt: 'llms.txt',
          botAccess: 'Bot Access Summary',
          aiCrawlingDirectives: 'AI Crawling Directives',
        });
        const tl = body.match(/Title:[^\n]*\n\s*Length:\s*(\d+)\s*characters\s*\(Status:\s*([^)]+)\)/i);
        if (tl) {
          s.titleLength = Number(tl[1]);
          s.titleStatus = tl[2].trim();
        }
        const dl = body.match(/Meta Description:[^\n]*\n\s*Length:\s*(\d+)\s*characters\s*\(Status:\s*([^)]+)\)/i);
        if (dl) {
          s.descriptionLength = Number(dl[1]);
          s.descriptionStatus = dl[2].trim();
        }
        const sm = [...body.matchAll(/^\s*\d+\.\s*(https?:\/\/\S+\.xml)\s*$/gm)].map((m) => m[1]);
        if (sm.length) s.sitemaps = sm;
        const allowed = body.match(/(\d+)\s*allowed,\s*(\d+)\s*blocked/i);
        if (allowed) {
          s.botsAllowed = Number(allowed[1]);
          s.botsBlocked = Number(allowed[2]);
        }
        report.sections.metadata = s;
        break;
      }
      case 'headings':
        report.sections.headings = parseHeadings(body);
        break;
      case 'content':
        report.sections.content = pick(body, {
          totalWords: 'Total Words',
          readingTime: 'Reading Time',
          readability: 'Readability Score',
          paragraphs: 'Paragraphs',
          sentences: 'Sentences',
          vocabulary: 'Vocabulary',
          contentDepthScore: 'Content Depth Score',
          topicRelevance: 'Topic Relevance',
          pageIntent: 'Page Intent',
          industry: 'Industry Detected',
          focusKeywords: 'Focus Keywords',
          scanabilityScore: 'Scanability Score',
          topicAuthorityScore: 'Topic Authority Score',
          topKeyPhrases: 'Top Key Phrases',
        });
        break;
      case 'links':
        report.sections.links = pick(body, {
          total: 'Total Links',
          internal: 'Internal',
          external: 'External',
          averageInternalLinkDepth: 'Average Internal Link Depth',
        });
        break;
      case 'images':
        report.sections.images = pick(body, {
          total: 'Total Images',
          missingAlt: 'Missing Alt Text',
          oversized: 'Oversized \\(needs optimization\\)',
          largeFiles: 'Large Files \\(could be optimized\\)',
          modernFormats: 'Modern Formats \\(WebP/AVIF\\)',
          missingDimensions: 'Missing Width/Height',
        });
        break;
      case 'video':
        report.sections.video = { summary: /No videos found/i.test(body) ? 'No videos found on this page' : 'Videos present' };
        break;
      case 'schema': {
        const s = pick(body, {
          totalSchemas: 'Total Schemas',
          valid: 'Valid',
          withIssues: 'With Issues',
          validWithWarnings: 'Valid with Warnings',
          typesFound: 'Types Found',
        });
        report.sections.schema = s;
        break;
      }
      case 'social':
        report.sections.social = pick(body, {
          openGraph: 'Open Graph',
          title: 'Title',
          siteName: 'Site Name',
          type: 'Type',
          image: 'Image',
          twitterCard: 'Twitter Card',
        });
        break;
      case 'local':
        report.sections.local = pick(body, {
          businessName: 'Business Name',
          address: 'Address',
          phone: 'Phone',
          email: 'Email',
          localSeoScore: 'Local SEO Score',
          keyElementLocationScore: 'Key Element Location Score',
        });
        break;
      case 'performance': {
        const s: Record<string, string | number | string[]> = {};
        if (/No CrUX data available/i.test(body)) s.realUserData = 'No CrUX data available for this page/origin';
        if (/No lab test results yet/i.test(body)) s.labTest = 'No lab test results yet';
        const sc = body.match(/Script Analysis:\s*(\d+)\s*scripts/i);
        if (sc) s.scripts = Number(sc[1]);
        report.sections.performance = s;
        break;
      }
    }
  }
  return report;
}
