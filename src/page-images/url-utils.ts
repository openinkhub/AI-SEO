// Normalizes a URL for duplicate-detection only (never shown/stored as the
// display value). Mirrors the WP plugin's normalize_url(): strips protocol,
// leading "www.", trailing slash, query string and fragment, lowercases.
export function normalizeUrl(raw: string): string {
  let u = raw.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '');
  u = u.replace(/^www\./, '');
  u = u.split('#')[0].split('?')[0];
  u = u.replace(/\/+$/, '');
  return u;
}

export function withProtocol(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function sameDomain(url: string, baseHost: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === baseHost.replace(/^www\./, '');
  } catch {
    return false;
  }
}

// Turns the last non-empty path segment of a URL into a human-readable
// guess at a page name, e.g. "/our-services/" -> "Our Services".
// This is a placeholder — the WP plugin eventually pulls the real
// navigation-menu label instead; flagged as a future improvement.
export function guessPageName(url: string): string {
  try {
    const path = new URL(withProtocol(url)).pathname;
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'Home';
    const last = decodeURIComponent(segments[segments.length - 1]);
    return last
      .replace(/[-_]+/g, ' ')
      .replace(/\.(html?|php)$/i, '')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || 'Home';
  } catch {
    return 'Page';
  }
}

// Short stable alias for a page, derived from the last URL path segment:
// "/our-services/" -> "our-services", site root -> "home". Editable later.
export function aliasFromUrl(url: string): string {
  try {
    const segments = new URL(withProtocol(url)).pathname.split('/').filter(Boolean);
    if (segments.length === 0) return 'home';
    const last = decodeURIComponent(segments[segments.length - 1]).replace(/\.(html?|php)$/i, '');
    const alias = last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return alias || 'page';
  } catch {
    return 'page';
  }
}
