// AI-search (AEO / GEO / AIO) knowledge base used when the monthly SEO Strategy is written.
// Supplied by Openink Hub (28 Oct 2026). These are general industry findings, not measurements of one client:
// the strategy may use them to choose and explain actions, but must not present them as the client's own data.

export interface GeoFact {
  key: string;
  fact: string; // the finding, as supplied
  action: string; // what to do about it, phrased for the strategy
}

export const GEO_FACTS: GeoFact[] = [
  {
    key: 'reddit',
    fact: 'Reddit presence correlates 0.737 with AI citations on Perplexity — community engagement matters.',
    action: 'Build genuine community presence (Reddit and similar forums) with helpful, non-promotional answers in the client’s topics.',
  },
  {
    key: 'statistics',
    fact: 'Content with specific statistics and named sources scores 40% higher on citability.',
    action: 'Add specific statistics with named, linked sources to key pages and blogs.',
  },
  {
    key: 'bing',
    fact: 'Bing Copilot heavily weights the IndexNow protocol and Bing Webmaster Tools verification.',
    action: 'Verify the site in Bing Webmaster Tools and enable IndexNow so new and changed pages reach Bing (and Copilot) quickly.',
  },
  {
    key: 'wikipedia',
    fact: '47.9% of ChatGPT citations reference Wikipedia — having a Wikipedia article dramatically increases AI visibility.',
    action: 'Where the brand meets Wikipedia’s notability rules, work towards a properly sourced Wikipedia presence; otherwise earn mentions on other sources AI models trust.',
  },
  {
    key: 'passage',
    fact: 'The optimal passage length for AI citation is 134-167 words — self-contained blocks that AI can quote directly.',
    action: 'Write key answers as self-contained passages of about 134-167 words that can be quoted on their own.',
  },
  {
    key: 'llms',
    fact: 'llms.txt is an emerging standard that helps AI systems understand your site structure — only about 5% of sites have one.',
    action: 'Publish an llms.txt file that lists the site’s main pages and what they cover.',
  },
  {
    key: 'sameas',
    fact: 'Schema.org sameAs links help AI models connect your brand across platforms — link to Wikipedia, LinkedIn, YouTube.',
    action: 'Add Organization schema with sameAs links to the brand’s Wikipedia (if any), LinkedIn, YouTube and other official profiles.',
  },
  {
    key: 'eeat',
    fact: 'E-E-A-T stands for Experience, Expertise, Authoritativeness and Trustworthiness — each scored out of 25 points.',
    action: 'Strengthen visible E-E-A-T: named authors with credentials, first-hand experience, cited sources, clear About / contact / policy pages.',
  },
  {
    key: 'crawlers',
    fact: 'AI crawlers like GPTBot and ClaudeBot do not execute JavaScript — server-side rendering is critical for GEO.',
    action: 'Make sure important content is in the server-rendered HTML (not only added by JavaScript) and that robots.txt allows the AI crawlers.',
  },
  {
    key: 'overviews',
    fact: 'Google AI Overviews favor content with Q&A-style headings, direct answers in the first 2 sentences, and data tables.',
    action: 'Use question-style headings, give the direct answer in the first two sentences, and add data tables where a comparison helps.',
  },
];

// Compact text for the AI strategy prompt.
export function geoKnowledgeAsPromptText(): string {
  return GEO_FACTS.map((f) => `- ${f.fact}`).join('\n');
}
