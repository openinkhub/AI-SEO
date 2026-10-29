// Openink Hub "AI SEO - Service Scope & Deliverables" (the signed PDF, dated 01/06/2026), kept as data so
// the customer package, the AI strategy prompt and the admin UI all read one source.
// Pricing ("Commercial Offering") is deliberately NOT part of the customer package.

export interface ScopeItem {
  title: string;
  text: string;
  note?: string;
  monthly?: string; // monthly quantity for ongoing activities
}
export interface ScopeSection {
  key: string;
  title: string;
  items: ScopeItem[];
  note?: string;
  ongoing?: boolean; // monthly ongoing activity (highlighted, with monthly numbers)
}

export const SCOPE_TARGETS: Array<{ label: string; target: string }> = [
  { label: 'Domain Authority', target: '70 by M10' },
  { label: 'Domain Rating', target: '70 by M10' },
  { label: 'AI Overview', target: '40%+' },
];

// "Target & Goals" block of the signed scope PDF (shown under the three big targets).
export const SCOPE_GOALS: ScopeItem[] = [
  { title: 'Domain Authority', text: 'Target a score of 70+ to strengthen overall ranking potential site-wide.' },
  { title: 'Domain Rating', text: 'Build backlinks toward a Domain Rating of 70+ to boost competitive standing.' },
  { title: 'AI Overview', text: 'Appear in 40%+ of relevant AI-generated answers across platforms like ChatGPT and Gemini.' },
  { title: 'Target Achievement', text: 'A monthly ongoing project, with the targets to be achieved in M10–M12.' },
];

const PREMIUM_PLATFORMS =
  'Google Sites, Blogger, WordPress, Medium, Substack, Notion, Weebly, Strikingly, Hashnode, Evernote, Beehiiv, LiveJournal, Pearltrees, WriteUpCafe, Misar, JustPaste.it, Nexorapress, Prime Narrative, Startupstack, Beyondmetrics, Nextreach, Growthscript, SignalLoom, and Openinkhub';
const SOCIAL_PLATFORMS =
  'Instagram, Facebook, LinkedIn, YouTube, TikTok, X, Threads, Pinterest, Google Business, Bluesky, Mastodon, Tumblr, Telegram, Discord, WordPress, Dev.to, Reddit, and Quora';

// "ongoing" sections are monthly activities: each item carries its monthly number and is highlighted in the report.
export const SCOPE_SECTIONS: ScopeSection[] = [
  {
    key: 'strategy',
    title: 'Strategy & Technical Foundation',
    items: [
      { title: 'Comprehensive Competitor Analysis', text: 'In-depth evaluation of your top competitors’ organic strategies, backlink profiles, and keyword gaps to carve out your market advantage.' },
      { title: 'Technical SEO Assessment & Fixes', text: 'Audit and optimization of site architecture, crawlability, indexing, page speed (Core Web Vitals), and mobile-friendliness.' },
      { title: 'Google Search Console Setup & Configuration', text: 'Full setup, sitemap submission, indexing monitoring, and error resolution to keep your site perfectly aligned with Google’s health standards.' },
      { title: 'On-Page SEO Optimization', text: 'Meticulous tuning of meta titles, descriptions, H1–H6 header structures, URL architectures, and internal linking across key landing pages.' },
      { title: 'Website Content Optimization', text: 'Refining existing copy to improve readability, user engagement, semantic relevance, and keyword density without compromising brand voice.' },
    ],
  },
  {
    key: 'brand',
    title: 'Brand Authority & AI Driven Content Optimization',
    ongoing: true,
    items: [
      { title: '30 Keyword Mapping', monthly: '30', text: 'High-intent keyword research mapped strategically across 30 target pages to ensure precise targeting and zero keyword cannibalization.' },
      { title: '30 Custom AI Prompts', monthly: '30', text: 'Development of a tailored library of 30 specialized AI prompts designed specifically for your brand to streamline ongoing content creation and scaling.' },
      { title: '30 FAQ Section Development', monthly: '30', text: 'Creation of schema-marked FAQ sections to capture featured snippets and address direct user search queries efficiently.' },
      { title: '30 Website Blogs', monthly: '30', text: 'SEO-optimized blog content created for your website and mapped to your target keywords to build topical authority and capture long-tail search traffic.' },
      { title: '30 Webpages Optimization', monthly: '30', text: 'On-page optimization of 30 target webpages, aligned with the keyword mapping, covering meta tags, header structure, URLs, internal linking, and content.' },
      { title: '30 Premium Platform Publication', monthly: '30', text: `Daily publishing on each platform, with AI-written, SEO-optimized content targeting one webpage per post. Platforms: ${PREMIUM_PLATFORMS}.` },
      { title: '18 Social Platform Publication', monthly: '18', text: `Content publishing across 18 social platforms: ${SOCIAL_PLATFORMS}.` },
      { title: 'Backlink Submission - 300', monthly: '300', text: 'Business and brand backlinks submitted across 300 relevant platforms per month to build authority and referral visibility.' },
    ],
  },
  {
    key: 'advanced',
    title: 'Advanced Search Optimization (AEO, GEO, AIO & CXO)',
    items: [
      { title: 'Answer Engine Optimization (AEO)', text: 'Structuring data and conversational content to directly feed voice assistants and direct-answer engines (like Alexa, Siri, and Google Assistant).' },
      { title: 'Generative Engine Optimization (GEO)', text: 'Optimizing brand footprint and content formatting to ensure your business is accurately cited and recommended by LLM search tools (like Perplexity, Gemini, and ChatGPT).' },
      { title: 'AI Optimization (AIO)', text: 'Adapting site-wide semantic structures to align perfectly with search engines’ evolving AI search layout algorithms.' },
      { title: 'CXO (Conversational Experience Optimization)', text: 'Structuring content and brand touchpoints for natural, chat-based interactions across AI assistants and conversational interfaces to improve discoverability and engagement.' },
    ],
  },
  {
    key: 'local',
    title: 'Local SEO & Business Visibility',
    items: [
      { title: 'Local SEO Optimization', text: 'Hyper-targeted optimization to dominate local search queries, geo-targeted terms, and map-packs in your specific operating regions.' },
      { title: 'Google Business Profile Optimization', text: 'Full optimization of your Google Business Profile, including categorization, localized descriptions, review strategy, and localized posts.' },
    ],
  },
  {
    key: 'social',
    title: 'Social Media Optimization',
    ongoing: true,
    items: [
      { title: 'Platforms Covered', monthly: '5', text: 'Facebook, Instagram, YouTube, LinkedIn, and Twitter.' },
      { title: 'Scope', text: 'Only Primary Profile Optimization — focus on Banner, Logo, Heading, Description, and Profile NAP (Name, Address, Phone) consistency.' },
      { title: 'Brand Analysis', monthly: '1', text: 'Analysis of your brand presence across social platforms to generate a Brand Audit Report.' },
    ],
  },
];

export const SCOPE_EXTRA_INTRO = 'The following services are offered separately and can be availed on extra charges as applicable:';

export const SCOPE_EXTRA_SERVICES: ScopeItem[] = [
  { title: 'ORM (Online Reputation Management)', text: 'Proactive monitoring and management of online reviews, mentions, and brand sentiment across search and social platforms. Includes response strategy for negative reviews and ongoing reputation health tracking.' },
  { title: 'Digital PR', text: 'Outreach to media publications and industry platforms for feature stories, expert quotes, and brand mentions. Includes press release drafting, distribution, and earned media links from high-authority news outlets.' },
  { title: 'Backlinks (Premium/Additional)', text: 'Access to premium, niche-specific backlink opportunities beyond the standard package. Includes higher DA/DR placements and customized outreach for competitive keyword clusters.' },
  { title: 'Multi Language Blogs', text: 'Blog content translated and localized into multiple languages for regional or global audience reach. Includes native-language SEO optimization and culturally adapted messaging for each target market.' },
  { title: 'International SEO', text: 'Strategic optimization to target audiences across multiple countries and regions through dedicated Local Pages for each market. Includes hreflang implementation, geo-targeted content, and region-specific keyword mapping tailored to local search behavior and language preferences.' },
  { title: 'GMB (Google Business Profile) Management', text: 'Complete management of your Google Business Profile.' },
  { title: 'Website Development (Customized Package)', text: 'Custom-scoped website development tailored to your requirements.' },
  { title: 'WordPress & Next.js Development', text: 'Complete website development. WordPress builds use PHP and MySQL with a custom theme, an SEO plugin, and caching; Next.js builds use React and Node.js with server-side rendering and static generation for fast page speed. Both include SEO-optimized product pages, service pages, and location pages.' },
  { title: 'Social Media Marketing', text: 'Social media marketing across 5 platforms: Facebook, Instagram, X, LinkedIn, and YouTube.' },
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

// The scope is common to every month (no month-specific wording).
export function monthDeliverableNote(_monthIndex: number | null): string | null {
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
  lines.push('ONGOING MONTHLY ACTIVITIES: ' + SCOPE_SECTIONS.filter((x) => x.ongoing).map((x) => `${x.title} (` + x.items.filter((i) => i.monthly).map((i) => `${i.title} ${i.monthly}`).join(', ') + ')').join('; '));
  lines.push('EXTRA SERVICES (paid add-ons, not part of the monthly scope): ' + SCOPE_EXTRA_SERVICES.map((i) => i.title).join('; '));
  return lines.join('\n');
}
