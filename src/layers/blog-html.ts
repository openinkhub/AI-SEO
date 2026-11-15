// Rich-text blog bodies: the Admin writes HTML, the customer panel renders it. Only a safe allow-list survives.
const ALLOWED = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'img', 'figure', 'figcaption', 'span', 'div', 'code', 'pre', 'sup', 'sub', 'mark', 'small']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button|link|meta|base)\b[\s\S]*?(<\/\1\s*>|$)/gi;
const ATTRS: Record<string, string[]> = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], '*': ['class'] };
const VOID = new Set(['br', 'hr', 'img']);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function safeUrl(v: string, img: boolean): string | null {
  const u = unesc(v).replace(/[\u0000-\u001f\u007f\s]+/g, '').trim();
  if (!u) return null;
  if (/^(https?:|mailto:|tel:|#|\/(?!\/)|\.{0,2}\/)/i.test(u)) return unesc(v).trim();
  if (img && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(u)) return u;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//')) return unesc(v).trim(); // relative like "page.html"
  return null;
}

export function sanitizeBlogHtml(input: unknown): string {
  let s = String(input ?? '').replace(/\u0000/g, '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(DROP_WITH_CONTENT, '');
  const out: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  const open: string[] = [];
  while ((m = re.exec(s))) {
    if (m[4] !== undefined) { out.push(m[4] === '<' ? '&lt;' : m[4]); continue; }
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const i = open.lastIndexOf(tag);
      if (i < 0) continue;
      while (open.length > i) out.push('</' + open.pop() + '>');
      continue;
    }
    let attrs = '';
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a: RegExpExecArray | null;
    const allow = (ATTRS[tag] || []).concat(ATTRS['*']);
    const seen = new Set<string>();
    while ((a = ar.exec(m[3]))) {
      const name = a[1].toLowerCase();
      if (!allow.includes(name) || seen.has(name)) continue;
      let val = a[2] ?? a[3] ?? a[4] ?? '';
      if (name === 'href' || name === 'src') { const u = safeUrl(val, tag === 'img'); if (u === null) continue; val = u; }
      else if (name === 'class') val = val.replace(/[^-_a-zA-Z0-9 ]/g, '').trim();
      else if (name === 'target') val = val === '_blank' ? '_blank' : '_self';
      else if (['width', 'height', 'colspan', 'rowspan'].includes(name)) val = val.replace(/[^0-9%]/g, '');
      seen.add(name);
      attrs += ` ${name}="${esc(unesc(val))}"`;
    }
    if (tag === 'a' && seen.has('target')) attrs += (seen.has('rel') ? '' : ' rel="noopener noreferrer"');
    if (tag === 'img' && !seen.has('src')) continue;
    out.push('<' + tag + attrs + (VOID.has(tag) ? ' />' : '>'));
    if (!VOID.has(tag)) open.push(tag);
  }
  while (open.length) out.push('</' + open.pop() + '>');
  return out.join('').trim();
}

export function htmlToText(html: string): string {
  return unesc(String(html || '').replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|\/div)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function countWords(html: string): number {
  const t = htmlToText(html);
  return t ? t.split(' ').length : 0;
}
