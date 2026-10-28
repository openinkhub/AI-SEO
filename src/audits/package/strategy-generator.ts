import { Logger } from '@nestjs/common';
import { SCOPE_SECTIONS, SCOPE_TARGETS, scopeAsPromptText } from './service-scope';

const logger = new Logger('StrategyGenerator');

export interface Strategy {
  executiveSummary: string;
  currentPosition: string[];
  targets: Array<{ label: string; target: string; note: string }>;
  priorities: Array<{ area: string; title: string; why: string; actions: string[]; when: string }>;
  plan: Array<{ period: string; focus: string; actions: string[] }>;
  risks: string[];
  kpis: string[];
}

export interface StrategyInput {
  companyName: string;
  website: string;
  industry?: string | null;
  description?: string | null;
  competitors?: string | null;
  monthCode?: string | null;
  monthIndex?: number | null;
  findings: Array<{ finding: string; suggestion: string | null }>;
  evidence: Array<{ tool: string; type: string; summary: string }>;
}

export function strategyAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const AREAS = SCOPE_SECTIONS.map((s) => s.title);

// Scope wording fixes applied to every strategy text (old drafts said "1000 profile submissions").
const fixScope = (t: string): string =>
  t
    .replace(/\b1,?000(?=\s+(?:[\w-]+\s+){0,2}(?:profile|submission))/gi, '300')
    .replace(/\bprofile\s+submissions?/gi, 'backlink submissions')
    .replace(/\b(Domain Authority(?:\s*\(DA\))?(?:\s+of)?\s+)40\+/gi, '$160+')
    .replace(/\b(DA\s+(?:of\s+)?)40\+/g, '$160+');
const str = (v: unknown, max = 600): string => (typeof v === 'string' ? fixScope(v.trim()).slice(0, max) : '');
const strList = (v: unknown, maxItems = 12, max = 400): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, maxItems) : [];

// Accepts anything (model output or an admin's edited JSON) and returns a well-formed Strategy.
export function normalizeStrategy(raw: unknown): Strategy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const targetsIn: any[] = Array.isArray(o.targets) ? o.targets : [];
  const targets = SCOPE_TARGETS.map((t) => {
    const found = targetsIn.find((x) => x && (str(x.label).toLowerCase() === t.label.toLowerCase() || (t.label === 'AI Overview' && str(x.label).toLowerCase() === 'competitive standing') || (t.label === 'Domain Rating' && str(x.label).toLowerCase() === 'traffic growth')));
    return { label: t.label, target: t.target, note: str(found?.note, 400) };
  });
  const priorities = (Array.isArray(o.priorities) ? o.priorities : [])
    .slice(0, 10)
    .map((p: any) => ({
      area: str(p?.area, 120),
      title: str(p?.title, 200),
      why: str(p?.why, 500),
      actions: strList(p?.actions, 8),
      when: str(p?.when, 60),
    }))
    .filter((p: { title: string }) => p.title);
  const plan = (Array.isArray(o.plan) ? o.plan : [])
    .slice(0, 6)
    .map((p: any) => ({ period: str(p?.period, 60), focus: str(p?.focus, 200), actions: strList(p?.actions, 8) }))
    .filter((p: { period: string; focus: string }) => p.period || p.focus);
  return {
    executiveSummary: str(o.executiveSummary, 1800),
    currentPosition: strList(o.currentPosition, 10),
    targets,
    priorities,
    plan,
    risks: strList(o.risks, 8),
    kpis: strList(o.kpis, 10),
  };
}

function buildPrompt(input: StrategyInput): string {
  const findings = input.findings
    .slice(0, 45)
    .map((f, i) => `${i + 1}. ${f.finding}${f.suggestion ? ` -> suggestion: ${f.suggestion}` : ''}`)
    .join('\n');
  const evidence = input.evidence
    .slice(0, 24)
    .map((e) => `- [${e.tool}/${e.type}] ${e.summary}`)
    .join('\n');
  return `You are the senior SEO strategist at Openink Hub. Write the monthly SEO STRATEGY for one client, based ONLY on the audit data below and the agreed service scope. Plain, client-friendly English. Do not invent numbers that are not in the data; where the data is thin say so briefly.

CLIENT
Company: ${input.companyName}
Website: ${input.website}
Industry: ${input.industry || 'not provided'}
About: ${input.description || 'not provided'}
Competitors: ${input.competitors || 'not provided'}
Month cycle: ${input.monthCode || 'unknown'}${input.monthIndex === 0 ? ' (starting month: no blog published, 300 backlink submissions)' : ''}

AGREED SERVICE SCOPE (only plan work inside this scope)
${scopeAsPromptText(input.monthIndex ?? null)}

SEO AUDIT FINDINGS
${findings || '(no automated findings)'}

TOOL EVIDENCE (approved or extracted from the tools the team ran)
${evidence || '(none)'}

RULES
- Never promise or guarantee rankings, traffic or revenue. Targets are goals, not guarantees.
- Every priority must name one "area" taken exactly from this list: ${AREAS.join(' | ')}.
- Do not plan website designing, development, implementation or publishing of site changes (indicative only); phrase these as recommendations the client's team implements.
- Prioritise by impact on the three targets (Domain Authority 60+, Domain Rating 60%+, AI Overview 40%+).
- 4 to 7 priorities, a 4-week plan (period "Week 1".."Week 4"), 3 to 5 risks, 4 to 6 KPIs.

Reply with ONLY a JSON object of this exact shape:
{"executiveSummary":"3-5 sentences","currentPosition":["short bullet",...],"targets":[{"label":"Domain Authority","note":"how this month moves toward it"},{"label":"Domain Rating","note":"..."},{"label":"AI Overview","note":"..."}],"priorities":[{"area":"...","title":"...","why":"...","actions":["..."],"when":"Week 1-2"}],"plan":[{"period":"Week 1","focus":"...","actions":["..."]}],"risks":["..."],"kpis":["..."]}`;
}

export async function generateStrategyWithAi(input: StrategyInput): Promise<Strategy> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 6000, messages: [{ role: 'user', content: buildPrompt(input) }] }),
  });
  const body = (await res.json().catch(() => ({}))) as { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    logger.warn(`Strategy call failed: ${msg}`);
    throw new Error(`Strategy writer failed: ${msg}`);
  }
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The strategy writer returned no JSON.');
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(a, b + 1));
  } catch {
    throw new Error('The strategy writer returned JSON that could not be parsed.');
  }
  const s = normalizeStrategy(obj);
  if (!s.executiveSummary || s.priorities.length === 0) throw new Error('The strategy writer returned an incomplete strategy.');
  return s;
}

// No-model fallback: a sound first draft built from the findings and the service scope. The admin edits it.
const AREA_KEYWORDS: Array<{ area: string; re: RegExp }> = [
  { area: 'Strategy & Technical Foundation', re: /speed|vital|lcp|cls|mobile|ssl|https|robots|sitemap|canonical|redirect|crawl|index|broken|404|viewport|compress|cache/i },
  { area: 'On-Page & AI-Driven Content Optimization', re: /title|meta|description|heading|h1|h2|alt|image|content|word|keyword|schema|structured|faq|link/i },
  { area: 'Advanced Search Optimization (AEO, GEO, AIO & CXO)', re: /\bai\b|geo|aeo|llm|answer|citation|chatgpt|perplexity|llms\.txt/i },
  { area: 'Local SEO & Business Visibility', re: /local|business profile|gbp|nap|map/i },
  { area: 'Off Page SEO & Brand Authority', re: /backlink|authority|domain rating|referring|profile|brand mention/i },
];

export function ruleBasedStrategy(input: StrategyInput): Strategy {
  const groups = new Map<string, Array<{ finding: string; suggestion: string | null }>>();
  for (const f of input.findings) {
    const hit = AREA_KEYWORDS.find((k) => k.re.test(`${f.finding} ${f.suggestion ?? ''}`));
    const area = hit?.area ?? 'On-Page & AI-Driven Content Optimization';
    groups.set(area, [...(groups.get(area) ?? []), f]);
  }
  const priorities: Strategy['priorities'] = [];
  let n = 0;
  for (const area of AREAS) {
    const list = groups.get(area);
    if (!list?.length) continue;
    n += 1;
    priorities.push({
      area,
      title: `Fix the ${list.length} issue${list.length === 1 ? '' : 's'} found under ${area}`,
      why: list[0].finding.slice(0, 280),
      actions: list.slice(0, 6).map((f) => f.suggestion || f.finding).map((s) => s.slice(0, 300)),
      when: n <= 2 ? 'Week 1-2' : 'Week 3-4',
    });
  }
  priorities.push({
    area: 'Off Page SEO & Brand Authority',
    title: input.monthIndex === 0 ? 'Build the starting authority base' : 'Publish and syndicate this month’s blogs',
    why: 'Authority and fresh, keyword-mapped content move Domain Authority and Domain Rating the most.',
    actions:
      input.monthIndex === 0
        ? ['Complete the 300 backlink submissions for the starting month.', 'Confirm the 30 target pages and keyword mapping.']
        : ['Publish the month’s AI-assisted, human-edited blogs against the mapped keywords.', 'Syndicate each blog to the 30 premium sites.', 'Continue backlink submissions.'],
    when: 'Week 1-4',
  });
  return {
    executiveSummary: `This strategy turns the SEO audit of ${input.website || input.companyName} into this month’s plan. The audit found ${input.findings.length} item${input.findings.length === 1 ? '' : 's'} to act on. The plan fixes technical and on-page issues first, then builds authority and AI-search visibility, aiming at Domain Authority 60+, Domain Rating 60%+ and AI Overview 40%+. These are goals, not guarantees.`,
    currentPosition: input.findings.slice(0, 6).map((f) => f.finding.slice(0, 300)),
    targets: SCOPE_TARGETS.map((t) => ({ ...t, note: '' })),
    priorities,
    plan: [
      { period: 'Week 1', focus: 'Technical foundation and quick wins', actions: priorities.slice(0, 2).flatMap((p) => p.actions.slice(0, 2)) },
      { period: 'Week 2', focus: 'On-page optimization on the key pages', actions: ['Apply title, description and heading fixes across the mapped pages.'] },
      { period: 'Week 3', focus: 'Content and AI-search visibility', actions: ['Produce and publish blogs / FAQ content for the mapped keywords.'] },
      { period: 'Week 4', focus: 'Authority building and review', actions: ['Complete syndication and backlink submissions.', 'Review progress against the KPIs.'] },
    ],
    risks: [
      'Search engine algorithm updates can change results regardless of the work done.',
      'Changes the client or a third party make to the website without notice can undo optimization.',
      'Delays in providing platform access slow the plan.',
    ],
    kpis: ['Domain Authority', 'Organic traffic (sessions)', 'Number of keywords in the top 10 / top 30', 'Core Web Vitals pass rate', 'Pages indexed in Google Search Console', 'AI-search citations for the brand'],
  };
}
