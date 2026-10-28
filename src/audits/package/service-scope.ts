// Openink Hub "AI SEO - Service Scope & Deliverables" (the signed PDF, dated 01/06/2026), kept as data so
// the customer package, the AI strategy prompt and the admin UI all read one source.
// Pricing ("Commercial Offering") is deliberately NOT part of the customer package.

export interface ScopeItem {
  title: string;
  text: string;
  note?: string;
}
export interface ScopeSection {
  key: string;
  title: string;
  items: ScopeItem[];
  note?: string;
}

export const SCOPE_TARGETS: Array<{ label: string; target: string }> = [
  { label: 'Domain Authority', target: '60+' },
  { label: 'Domain Rating', target: '60%+' },
  { label: 'AI Overview', target: '40%+' },
];

export const SCOPE_SECTIONS: ScopeSection[] = [
  {
    key: 'strategy',
    title: 'Strategy & Technical Foundation',
    items: [
      { title: 'Comprehensive Competitor Analysis', text: 'In-depth evaluation of your top competitors’ organic strategies, backlink profiles, and keyword gaps to carve out your market advantage.' },
      { title: 'Technical SEO Assessment & Fixes', text: 'Audit and optimization of site architecture, crawlability, indexing, page speed (Core Web Vitals), and mobile-friendliness.' },
      { title: 'Google Search Console Setup & Configuration', text: 'Full setup, sitemap submission, indexing monitoring, and error resolution to keep your site aligned with Google’s health standards.' },
    ],
  },
  {
    key: 'onpage',
    title: 'On-Page & AI-Driven Content Optimization',
    items: [
      { title: '30 Keyword Mapping', text: 'High-intent keyword research mapped strategically across 30 target pages to ensure precise targeting and zero keyword cannibalization.' },
      { title: 'On-Page SEO Optimization', text: 'Tuning of meta titles, descriptions, H1–H6 header structures, URL architectures, and internal linking across key landing pages.' },
      {
        title: 'Website Content Optimization',
        text: 'Refining existing copy to improve readability, user engagement, semantic relevance, and keyword density without compromising brand voice.',
        note: 'Indicative only. Designing, development, implementation and publishing are not included in this scope of work.',
      },
      { title: '30 Custom AI Prompts', text: 'A tailored library of 30 specialized AI prompts designed for your brand to streamline ongoing content creation and scaling.' },
      { title: 'FAQ Section Development', text: 'Schema-marked FAQ sections to capture featured snippets and address direct user search queries.' },
    ],
  },
  {
    key: 'advanced',
    title: 'Advanced Search Optimization (AEO, GEO, AIO & CXO)',
    items: [
      { title: 'Answer Engine Optimization (AEO)', text: 'Structuring data and conversational content to feed voice assistants and direct-answer engines (such as Alexa, Siri and Google Assistant).' },
      { title: 'Generative Engine Optimization (GEO)', text: 'Optimizing brand footprint and content formatting so your business is accurately cited and recommended by LLM search tools (such as Perplexity, Gemini and ChatGPT).' },
      { title: 'AI Optimization (AIO)', text: 'Adapting site-wide semantic structures to align with search engines’ evolving AI search layout algorithms.' },
      { title: 'Conversational Experience Optimization (CXO)', text: 'Structuring content and brand touchpoints for natural, chat-based interactions across AI assistants and conversational interfaces to improve discoverability and engagement.' },
    ],
  },
  {
    key: 'local',
    title: 'Local SEO & Business Visibility',
    items: [
      { title: 'Local SEO Optimization', text: 'Targeted optimization for local search queries, geo-targeted terms, and map-packs in your operating regions.' },
      { title: 'Google Business Profile Optimization', text: 'Optimization of your Google Business Profile, including categorization, localized descriptions, review strategy, and localized posts.' },
    ],
    note: 'Complete management of the Google Business Profile is available at an extra charge (₹999/- per month).',
  },
  {
    key: 'offpage',
    title: 'Off Page SEO & Brand Authority',
    items: [
      {
        title: 'Blogs: 30 AI Content Blogs / Articles Published',
        text: 'Production and publishing of high-quality, AI-assisted, human-edited blog posts mapped to your target keywords, with syndication of each blog published on the website to 30 premium sites (Blogger, Google Site, WordPress, Medium, Reddit, Substack, Quora, Notion, Weebly, Hashnode, Evernote, Beehiiv, Behance, Tumblr, Live Journal, Slideshare, Flipboard, Writeup Cafe, E27, All4webs, Just Paste It, Over Blog, Articleted, Pearl Trees, LinkedIn, Facebook, YouTube, Threads, Pinterest and Twitter).',
      },
      { title: 'Backlink Submission - 300', text: 'Business and brand backlinks submitted across 300 relevant platforms to build authority and referral visibility.' },
    ],
    note: 'M0 (starting month): no blog is published; 300 backlink submissions are made instead.',
  },
  {
    key: 'social',
    title: 'Social Media Optimization',
    items: [
      { title: 'Platforms covered', text: 'Facebook, Instagram, Threads, YouTube, LinkedIn and Twitter.' },
      { title: 'Scope', text: 'Primary profile optimization only: banner, logo, heading, description, and profile NAP (Name, Address, Phone) consistency.' },
    ],
  },
];

export const SCOPE_EXTRA_SERVICES: ScopeItem[] = [
  { title: 'ORM (Online Reputation Management)', text: 'Monitoring and management of online reviews, mentions and brand sentiment across search and social platforms, including a response strategy for negative reviews and ongoing reputation health tracking.' },
  { title: 'Digital PR', text: 'Outreach to media publications and industry platforms for feature stories, expert quotes and brand mentions, including press release drafting, distribution and earned media links from high-authority outlets.' },
  { title: 'Backlinks (Premium / Additional)', text: 'Premium, niche-specific backlink opportunities beyond the standard package, including higher DA/DR placements and customized outreach for competitive keyword clusters.' },
  { title: 'Multi Language Blogs', text: 'Blog content translated and localized into multiple languages, with native-language SEO optimization and culturally adapted messaging for each target market.' },
  { title: 'International SEO', text: 'Optimization to target audiences across multiple countries and regions through dedicated local pages for each market, including hreflang implementation, geo-targeted content and region-specific keyword mapping.' },
];

export const SCOPE_PLATFORM_NOTE =
  'Openink Hub is developing an AI-driven automated platform (SaaS) with a Customer Live Dashboard. Platform access ends when the monthly subscription ends.';

export interface TermsSection {
  heading: string;
  intro?: string;
  bullets?: string[];
  note?: string;
}

export const TERMS_INTRO =
  'These Terms and Conditions (“Agreement”) govern the Search Engine Optimization (SEO) services provided by Openinkhub (“Company”, “we”, “us” or “our”) to the client (“Client”, “you” or “your”). By engaging our services, you agree to comply with and be bound by the following terms.';

export const TERMS: TermsSection[] = [
  {
    heading: '1. Scope of Services & Access Requirements',
    intro:
      'To perform comprehensive SEO optimization, strategic planning, and implementation, Openinkhub requires specific administrative or manager-level access. The Client agrees to provide timely and secure access to the following platforms as required for the duration of the project:',
    bullets: [
      'Google Ecosystem: Gmail, Google Business Profile (GMB), Google Search Console, Google Analytics, Google Tag Manager, Google Ads, Google Drive, and YouTube.',
      'Social & Advertising Media: Facebook Page & Meta Ads Manager, Instagram, and LinkedIn.',
      'Technical Infrastructure: Website Admin Panel (CMS), Web Hosting Account, and Domain Name System (DNS) settings.',
    ],
    note: 'Delay in providing these accesses may result in project delays, for which Openinkhub will not be held liable.',
  },
  {
    heading: '2. Data Privacy & Confidentiality',
    intro: 'Openinkhub is committed to maintaining the highest standards of data privacy and security.',
    bullets: [
      'Confidentiality: We will not share, sell, or disclose any proprietary business data, credentials, financial records, or strategic information to any third party without your explicit written consent.',
      'Access Management: All credentials and account access provided by the Client will be handled securely, restricted only to authorized personnel directly working on your project, and used solely for executing agreed-upon SEO strategies.',
      'Data Protection: We employ industry-standard security measures to safeguard your account information against unauthorized access or data breaches.',
    ],
  },
  {
    heading: '3. Client Obligations & Warranties',
    bullets: [
      'The Client guarantees that all website assets, text, images, and brand materials provided to Openinkhub are owned by the Client or that the Client has lawful permission to use them.',
      'The Client is encouraged to change all temporary passwords provided to Openinkhub once the service contract is concluded or terminated.',
    ],
  },
  {
    heading: '4. Service Disclaimer & Limitations',
    bullets: [
      'Search Engine Algorithms: Openinkhub uses ethical, industry-standard optimization techniques. However, search engines (like Google) constantly update their ranking algorithms. We do not guarantee specific rankings, traffic increases, or overnight revenue growth, as third-party platform algorithms are beyond our direct control.',
      'Third-Party Modifications: Openinkhub is not responsible for any drops in rankings or site functionality issues caused by changes made to the website or linked platforms by the Client or any third party without our prior knowledge.',
    ],
  },
  {
    heading: '5. Termination',
    intro:
      'Either party may terminate the SEO service agreement by providing written notice as specified in your individual service contract. Upon termination, Openinkhub will relinquish all manager/admin access to the platforms listed in Section 1.',
  },
];

export const COMPANY_FOOTER = 'Openink Hub · 203, Liya Complex, PP Compound Main Road, Ranchi-834001 · +91 9204135136 · www.openinkhub.io';
export const TERMS_SIGNED_DATE = '01/06/2026';

// Month-aware wording: M0 is the starting month (no blog, 300 backlink submissions).
export function monthDeliverableNote(monthIndex: number | null): string | null {
  if (monthIndex === 0) return 'This is your starting month (M0): no blog is published this month; 300 backlink submissions are made instead.';
  if (monthIndex != null) return 'This month: up to 30 AI blogs published and syndicated, and backlink submissions as per the scope above.';
  return null;
}

// Compact text used in the AI strategy prompt.
export function scopeAsPromptText(monthIndex: number | null): string {
  const lines: string[] = [];
  lines.push('TARGETS: ' + SCOPE_TARGETS.map((t) => `${t.label} ${t.target}`).join('; '));
  for (const s of SCOPE_SECTIONS) {
    lines.push(`${s.title}: ` + s.items.map((i) => i.title).join('; '));
  }
  const m = monthDeliverableNote(monthIndex);
  if (m) lines.push(m);
  lines.push('NOT INCLUDED: designing, development, implementation and publishing of website content changes (indicative only); complete GBP management and extra services (ORM, Digital PR, premium backlinks, multi-language blogs, international SEO) are paid add-ons.');
  return lines.join('\n');
}
