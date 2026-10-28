// The AI platforms the AI research Layers (4-10) ask. Six are called by API with a GLOBAL key
// (Global API Settings); Google AI uses the customer's own SerpApi key; Copilot and Meta AI are
// Manual by default (same as the WP plugin). DeepSeek is an Engine addition (the plugin has 8).
export interface AiPlatform {
  key: string;
  label: string;
  defaultMode: 'api' | 'manual';
  globalKey?: boolean; // called with a key from Global API Settings
  keyProvider?: string; // the Global API Settings entry that holds its key (default: the platform key)
}

export const AI_PLATFORMS: AiPlatform[] = [
  { key: 'openai', label: 'ChatGPT', defaultMode: 'api', globalKey: true },
  { key: 'gemini', label: 'Gemini', defaultMode: 'api', globalKey: true },
  { key: 'perplexity', label: 'Perplexity', defaultMode: 'api', globalKey: true },
  { key: 'anthropic', label: 'Claude', defaultMode: 'api', globalKey: true },
  { key: 'xai', label: 'Grok', defaultMode: 'api', globalKey: true },
  { key: 'deepseek', label: 'DeepSeek', defaultMode: 'api', globalKey: true },
  { key: 'copilot', label: 'Copilot', defaultMode: 'manual' },
  // Meta AI has no public API: API mode = a Meta Llama model through OpenRouter (switch to Manual to paste its answers).
  { key: 'meta', label: 'Meta AI', defaultMode: 'api', globalKey: true, keyProvider: 'openrouter' },
  // Google AI Overview + AI Mode through SerpApi; the key is a GLOBAL setting (provider "google_ai").
  { key: 'google_ai', label: 'Google AI', defaultMode: 'api', globalKey: true },
];

export const AI_PLATFORM_KEYS = AI_PLATFORMS.map((p) => p.key);
// Keys tested with a chat call (Google AI is a SerpApi key, tested separately).
export const GLOBAL_AI_KEYS = [...AI_PLATFORMS.filter((p) => p.globalKey && !p.keyProvider && p.key !== 'google_ai').map((p) => p.key), 'openrouter'];

// Defaults; the model can be changed per platform in Global API Settings.
export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  perplexity: 'sonar',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
  xai: 'grok-4',
  deepseek: 'deepseek-chat',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
};

type Vals = Record<string, string>;
const TIMEOUT = 120000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  let b: any = {};
  try { b = JSON.parse(text); } catch { /* keep {} */ }
  if (!res.ok) {
    const msg = b?.error?.message || b?.error || b?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.slice(0, 300));
  }
  return b;
}

// Sends one prompt to one platform and returns the reply text.
export async function askPlatform(platform: string, vals: Vals, prompt: string): Promise<string> {
  const key = vals.apiKey;
  const model = (vals.model || '').trim() || DEFAULT_MODELS[platform === 'meta' ? 'openrouter' : platform];
  if (!key) throw new Error('No API key saved for this platform.');
  if (platform === 'openai' || platform === 'xai' || platform === 'deepseek' || platform === 'perplexity' || platform === 'openrouter' || platform === 'meta') {
    const url = {
      openai: 'https://api.openai.com/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/chat/completions',
      perplexity: 'https://api.perplexity.ai/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      meta: 'https://openrouter.ai/api/v1/chat/completions',
    }[platform]!;
    const b = await postJson(url, { Authorization: `Bearer ${key}` }, { model, messages: [{ role: 'user', content: prompt }] });
    return String(b?.choices?.[0]?.message?.content ?? '');
  }
  if (platform === 'gemini') {
    const b = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {},
      { contents: [{ parts: [{ text: prompt }] }] },
    );
    const parts: any[] = b?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => String(p?.text ?? '')).join('');
  }
  if (platform === 'anthropic') {
    const b = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
    const blocks: any[] = b?.content ?? [];
    return blocks.map((x) => String(x?.text ?? '')).join('');
  }
  throw new Error(`No API caller for "${platform}".`);
}

const flattenBlocks = (blocks: any[]): string =>
  blocks
    .map((t) => [t?.snippet, ...(Array.isArray(t?.list) ? t.list.map((l: any) => [l?.title, l?.snippet].filter(Boolean).join(': ')) : [])].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n');

// Google AI Overview for a plain search query (SerpApi: engine=google, then engine=google_ai_overview when Google
// lazy-loads the overview and returns a short-lived page_token). Returns '' when Google shows no overview.
export async function googleAiOverview(serpApiKey: string, query: string, opts: { gl?: string; hl?: string } = {}): Promise<string> {
  const base = { hl: opts.hl || 'en', gl: opts.gl || 'in', no_cache: 'true', api_key: serpApiKey };
  const first = new URLSearchParams({ engine: 'google', q: query.slice(0, 200), json_restrictor: 'ai_overview', ...base });
  const res = await fetch(`https://serpapi.com/search.json?${first}`, { signal: AbortSignal.timeout(TIMEOUT) });
  const b: any = await res.json().catch(() => ({}));
  if (!res.ok || b.error) throw new Error(`SerpApi: ${b.error || `HTTP ${res.status}`}`);
  let ov = b.ai_overview;
  if (ov && !Array.isArray(ov.text_blocks) && ov.page_token) {
    const second = new URLSearchParams({ engine: 'google_ai_overview', page_token: String(ov.page_token), no_cache: 'true', api_key: serpApiKey });
    const r2 = await fetch(`https://serpapi.com/search.json?${second}`, { signal: AbortSignal.timeout(TIMEOUT) });
    const b2: any = await r2.json().catch(() => ({}));
    if (!r2.ok || b2.error) throw new Error(`SerpApi: ${b2.error || `HTTP ${r2.status}`}`);
    ov = b2.ai_overview;
  }
  return Array.isArray(ov?.text_blocks) ? flattenBlocks(ov.text_blocks).slice(0, 2500) : '';
}

// Google AI Mode (conversational prompt) through SerpApi.
export async function askGoogleAi(serpApiKey: string, prompt: string): Promise<string> {
  const q = new URLSearchParams({ engine: 'google_ai_mode', q: prompt.slice(0, 1800), api_key: serpApiKey });
  const res = await fetch(`https://serpapi.com/search.json?${q}`, { signal: AbortSignal.timeout(TIMEOUT) });
  const b: any = await res.json().catch(() => ({}));
  if (!res.ok || b.error) throw new Error(`SerpApi: ${b.error || `HTTP ${res.status}`}`);
  const blocks: any[] = Array.isArray(b.text_blocks) ? b.text_blocks : [];
  const text = blocks.map((t) => [t.snippet, ...(Array.isArray(t.list) ? t.list.map((l: any) => l.snippet) : [])].filter(Boolean).join('\n')).join('\n');
  return text || String(b.reconstructed_markdown ?? '');
}
