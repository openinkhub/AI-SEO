// Reads the CSV export of the PPCBlogPro "SEO / AEO / GEO" page checker. Fixed rules, no AI.
// Columns: Category, Status, Check, Weight, Detail, Fix, URL, Total Score, SEO, AEO, GEO, Content Type.

export interface PpcCheck {
  status: 'pass' | 'fix';
  check: string;
  weight: number;
  detail: string;
  fix: string;
}

export interface PpcReport {
  tool: 'ppcblogpro';
  pageUrl: string;
  contentType: string;
  scores: { total: number | null; seo: number | null; aeo: number | null; geo: number | null };
  categories: Record<string, PpcCheck[]>;
  counts: Record<string, { pass: number; fix: number }>;
}

// RFC4180-ish parser: quoted fields, doubled quotes, CRLF/LF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const HEADER = ['category', 'status', 'check', 'weight', 'detail', 'fix', 'url', 'total score', 'seo', 'aeo', 'geo', 'content type'];

export function looksLikePpcBlogPro(text: string): boolean {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase().replace(/"/g, '');
  return HEADER.every((h) => first.includes(h));
}

const num = (v: string | undefined): number | null => {
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

export function parsePpcBlogProCsv(text: string): PpcReport {
  const rows = parseCsv(text);
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ix = (name: string) => head.indexOf(name);
  const iCat = ix('category'), iSt = ix('status'), iChk = ix('check'), iW = ix('weight'), iD = ix('detail'), iF = ix('fix'),
    iUrl = ix('url'), iTot = ix('total score'), iSeo = ix('seo'), iAeo = ix('aeo'), iGeo = ix('geo'), iCt = ix('content type');
  const out: PpcReport = {
    tool: 'ppcblogpro',
    pageUrl: '',
    contentType: '',
    scores: { total: null, seo: null, aeo: null, geo: null },
    categories: {},
    counts: {},
  };
  for (const r of rows.slice(1)) {
    const cat = (r[iCat] ?? '').trim().toUpperCase();
    if (!cat) continue;
    if (!out.pageUrl) {
      out.pageUrl = (r[iUrl] ?? '').trim();
      out.contentType = (r[iCt] ?? '').trim();
      out.scores = { total: num(r[iTot]), seo: num(r[iSeo]), aeo: num(r[iAeo]), geo: num(r[iGeo]) };
    }
    const status = /^pass$/i.test((r[iSt] ?? '').trim()) ? 'pass' : 'fix';
    (out.categories[cat] ||= []).push({
      status,
      check: (r[iChk] ?? '').trim(),
      weight: num(r[iW]) ?? 0,
      detail: (r[iD] ?? '').trim(),
      fix: (r[iF] ?? '').trim(),
    });
    const c = (out.counts[cat] ||= { pass: 0, fix: 0 });
    c[status]++;
  }
  return out;
}
