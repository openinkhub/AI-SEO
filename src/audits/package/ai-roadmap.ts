
// AI Visibility Roadmap (6 months) + prompt library, from the Openink Hub roadmap and Prompt Tracker workbooks.
// Data only. It feeds three places: the Strategy writer (prompt text), the admin Strategy page, and the
// customer's personalised prompt set that is attached to every audit run.

export interface RoadmapPhase {
  key: string;
  name: string;
  timeline: string;
  activities: string[];
  deliverables: string[];
}

export const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    key: 'foundation',
    name: 'Foundation',
    timeline: 'Weeks 1-4',
    activities: [
      'Baseline audit: test 30-50 buyer prompts on ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews and Copilot',
      'Entity clean-up: one consistent name, description, address and services everywhere',
      'Technical access: allow AI crawlers in robots.txt, fast pages, server-rendered content',
      'Schema markup: Organization, Service, FAQ, Article, Person',
    ],
    deliverables: ['Baseline report', 'Prompt library and tracker', 'Technical fix list', 'Entity consistency sheet'],
  },
  {
    key: 'content',
    name: 'Content',
    timeline: 'Months 1-3',
    activities: [
      'Direct-answer pages: a concise answer under each question heading',
      'Comparison and "best X for Y" pages',
      'Definitive guides on core topics',
      'Original data: case studies, benchmarks, mini-surveys',
      'Named expert authors with credentials',
    ],
    deliverables: ['Content calendar', 'Priority pages published', 'Author profile pages'],
  },
  {
    key: 'authority',
    name: 'Authority',
    timeline: 'Months 2-6',
    activities: [
      'Review platforms: structured review collection (Clutch, G2, Trustpilot, Google)',
      'Digital PR: expert quotes, guest articles, podcasts, industry round-ups',
      'Community: helpful, non-promotional participation on Reddit and Quora',
      'YouTube: transcripts and explainers',
      'Inclusion in "best of" lists that already rank for the target queries',
    ],
    deliverables: ['Monthly placement log', 'Review growth report', 'Outreach tracker'],
  },
  {
    key: 'optimise',
    name: 'Optimise',
    timeline: 'Month 3 onward',
    activities: [
      'Monthly re-test of the same prompt set',
      'Find which pages and sources drive citations',
      'Refresh high-value pages and double down on winning formats',
      'Close the gaps where competitors are named instead',
    ],
    deliverables: ['Monthly scorecard', 'Quarterly strategy review'],
  },
];

export const ROADMAP_WORKSTREAMS: Array<{ name: string; points: string[] }> = [
  {
    name: 'Technical readiness',
    points: [
      'Allow GPTBot, ClaudeBot, PerplexityBot and Google-Extended unless there is a reason to block them',
      'Keep key content in HTML, not behind scripts or logins; keep pages fast and mobile friendly',
      'Implement and validate structured data on all priority pages',
    ],
  },
  {
    name: 'Answer-ready content',
    points: [
      'Lead each section with a direct, quotable answer of roughly 40-60 words, then add depth, evidence and examples',
      'Prioritise original facts AI tools cannot get elsewhere: real client results, pricing ranges, benchmarks, methodology',
      'Refresh key pages every few months and show visible "last updated" dates',
    ],
  },
  {
    name: 'Off-site authority',
    points: [
      'AI answers lean on what third parties say: this is the highest-impact and slowest-building track',
      'Focus on the sources AI tools already cite for the target prompts, found in the month 1 audit',
      'All community and PR work follows each platform\'s rules: no spam, fake reviews or purchased mentions',
    ],
  },
];

export const ROADMAP_KPIS: Array<{ metric: string; definition: string; frequency: string }> = [
  { metric: 'Mention rate', definition: '% of prompts where the brand is named in the answer', frequency: 'Monthly' },
  { metric: 'Citation rate', definition: "% of prompts where the brand's site is linked or cited", frequency: 'Monthly' },
  { metric: 'Share of voice', definition: 'Brand mentions as a share of all tracked brands', frequency: 'Monthly' },
  { metric: 'Sentiment', definition: 'Positive / neutral / negative framing of the brand', frequency: 'Monthly' },
  { metric: 'AI referral traffic', definition: 'Sessions from chatgpt.com, perplexity.ai, gemini and similar sources in GA4', frequency: 'Monthly' },
];

export const ROADMAP_EXPECTATIONS = [
  'Weeks 2-8: platforms that search the live web (Perplexity, Google AI Overviews, ChatGPT with search) can move within weeks of publishing and earning citations.',
  'Months 3-6: mentions that come from model training data depend on sustained third-party presence and usually take several months to shift.',
  'AI answers vary by session and by user, so results are tracked as trends across many prompts, never as a guaranteed placement for one prompt.',
];

export const PROMPT_LIBRARY: Array<{ id: string; category: string; stage: string; template: string }> = [
  { id: 'P01', category: 'Brand', stage: 'Awareness', template: 'What is [Brand] and what does it do?' },
  { id: 'P02', category: 'Brand', stage: 'Consideration', template: 'Is [Brand] good? Reviews and alternatives to [Brand]' },
  { id: 'P03', category: 'Category', stage: 'Awareness', template: 'What is [service] and how does it work?' },
  { id: 'P04', category: 'Category', stage: 'Awareness', template: 'How do I choose a [service] provider?' },
  { id: 'P05', category: 'Best-of', stage: 'Consideration', template: 'Best [service] companies in [city]' },
  { id: 'P06', category: 'Best-of', stage: 'Consideration', template: 'Top [service] for [audience]' },
  { id: 'P07', category: 'Comparison', stage: 'Consideration', template: '[Brand] vs [Competitor]: which is better?' },
  { id: 'P08', category: 'Comparison', stage: 'Consideration', template: 'Compare the top [service] providers by price and features' },
  { id: 'P09', category: 'Problem-led', stage: 'Awareness', template: 'How can I solve [problem]?' },
  { id: 'P10', category: 'Problem-led', stage: 'Consideration', template: 'What tools or agencies can help with [problem]?' },
  { id: 'P11', category: 'Pricing', stage: 'Decision', template: 'How much does [service] cost in [city]?' },
  { id: 'P12', category: 'Local / niche', stage: 'Decision', template: 'Recommend a [service] provider near [city] for [audience]' },
];

export interface PromptSetInput {
  brand: string;
  service: string;
  city: string;
  audience: string;
  problem: string;
  competitors: string[];
}

// Fills the placeholders for one customer. Prompts that need a value the profile does not have are skipped, and a
// comparison prompt is written once per named competitor (up to 3).
export function buildPromptSet(i: PromptSetInput): Array<{ id: string; category: string; stage: string; prompt: string }> {
  const out: Array<{ id: string; category: string; stage: string; prompt: string }> = [];
  const fill = (t: string, extra: Record<string, string> = {}): string | null => {
    const v: Record<string, string> = { brand: i.brand, service: i.service, city: i.city, audience: i.audience, problem: i.problem, competitor: '', ...extra };
    let missing = false;
    const s = t.replace(/\[([a-z]+)\]/gi, (_m, k: string) => {
      const val = v[k.toLowerCase()];
      if (!val) missing = true;
      return val ?? '';
    });
    return missing ? null : s;
  };
  for (const p of PROMPT_LIBRARY) {
    if (p.template.includes('[Competitor]')) {
      i.competitors.slice(0, 3).forEach((c, n) => {
        const s = fill(p.template, { competitor: c });
        if (s) out.push({ id: `${p.id}${n ? String.fromCharCode(97 + n) : ''}`, category: p.category, stage: p.stage, prompt: s });
      });
      continue;
    }
    const s = fill(p.template);
    if (s) out.push({ id: p.id, category: p.category, stage: p.stage, prompt: s });
  }
  return out;
}

export function roadmapAsPromptText(): string {
  const lines = ['AI VISIBILITY ROADMAP (6 months, four phases):'];
  for (const p of ROADMAP_PHASES) lines.push(`- ${p.name} (${p.timeline}): ${p.activities.join('; ')}.`);
  lines.push('MEASURE every month on a fixed prompt set: ' + ROADMAP_KPIS.map((k) => k.metric.toLowerCase()).join(', ') + '.');
  lines.push(ROADMAP_EXPECTATIONS[2]);
  return lines.join('\n');
}
