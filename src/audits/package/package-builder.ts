import { AuditRun } from '../audit-run.entity';
import { AuditTask } from '../audit-task.entity';
import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { customerReportBody, escapeHtml, formatDate, ReportPage, styleBlock } from '../report-builder';
import { Strategy } from './strategy-generator';
import { collectMetrics, parseMetric } from '../evidence/metrics';
import { STAMP_DATA_URI } from './stamp';
import {
  COMPANY_FOOTER,
  SCOPE_EXTRA_SERVICES,
  SCOPE_PLATFORM_NOTE,
  SCOPE_SECTIONS,
  SCOPE_TARGETS,
  TERMS,
  TERMS_INTRO,
  monthDeliverableNote,
} from './service-scope';

export interface PackageInput {
  customerName: string;
  website: string;
  monthCode: string | null;
  monthIndex: number | null;
  run: AuditRun;
  tasks: AuditTask[];
  evidence: AuditEvidence[];
  // Layer 3 page data (page, URL, alias, H1, meta tags, image) for the report's Website pages / Page mapping sections.
  pages?: ReportPage[];
  strategy: Strategy;
  preview?: boolean;
  // Date & time shown in the signature block (default: now, i.e. when the document is compiled).
  signedAt?: Date;
}

const e = escapeHtml;
const ul = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '');

function packageStyle(): string {
  return `<style>
    .pkg-cover { background:#1a1a2e; color:#fff; padding:48px 24px 40px; }
    .pkg-cover .inner { max-width:1100px; margin:0 auto; }
    .pkg-cover h1 { font-size:34px; margin:10px 0 6px; }
    .pkg-cover .sub { opacity:.85; font-size:15px; margin:0; }
    .pkg-toc { background:#fff; border:1px solid #e2e2ea; border-radius:10px; padding:14px 22px; margin:20px auto; max-width:1052px; font-size:14px; }
    .pkg-toc a { color:#2563eb; text-decoration:none; margin-right:18px; display:inline-block; }
    .pkg-part { page-break-before:always; }
    .pkg-part > h2.part { font-size:24px; border-bottom:3px solid #2563eb; padding-bottom:8px; margin:0 0 14px; }
    .pkg-card { background:#fff; border:1px solid #e2e2ea; border-radius:10px; padding:16px 20px; margin:0 0 14px; }
    .pkg-card h3 { margin:0 0 6px; font-size:16px; color:#1a1a2e; }
    .pkg-card .area { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#2563eb; font-weight:700; }
    .pkg-card .when { float:right; font-size:12px; color:#5b5b6e; background:#f1f1f6; border-radius:20px; padding:2px 10px; }
    .pkg-card ul, .pkg-part ul { margin:6px 0 0 18px; padding:0; } .pkg-part li { margin:3px 0; font-size:14px; }
    .pkg-targets { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:14px; }
    .pkg-target { flex:1 1 220px; background:#fff; border:1px solid #e2e2ea; border-radius:10px; padding:14px 18px; }
    .pkg-target .big { font-size:28px; font-weight:700; color:#2563eb; }
    .pkg-target .lab { font-size:12px; color:#5b5b6e; text-transform:uppercase; letter-spacing:.04em; }
    .pkg-goal { width:100%; border-collapse:collapse; margin:6px 0 4px; font-size:14px; background:#fff; }
    .pkg-goal th, .pkg-goal td { border:1px solid #e2e2ea; padding:6px 10px; text-align:center; }
    .pkg-goal th { background:#f1f1f6; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#5b5b6e; }
    .pkg-goal td.new { font-weight:700; color:#2563eb; } .pkg-goal td.hold { color:#8a8a99; }
    .pkg-goal tr.now td { background:#eef4ff; } .pkg-goal .ok { color:#15803d; font-weight:700; } .pkg-goal .wait { color:#b45309; font-weight:700; }
    .pkg-note { font-size:13px; color:#5b5b6e; font-style:italic; margin:6px 0 0; }
    .pkg-preview { background:#fff7e0; border-bottom:1px solid #e8d48a; color:#6b5200; padding:10px 24px; font-size:14px; text-align:center; font-weight:600; }
    .pkg-terms h3 { margin:16px 0 4px; font-size:15px; } .pkg-terms p { font-size:13.5px; line-height:1.55; margin:4px 0; }
    .pkg-sign { margin-top:28px; font-size:14px; } .pkg-sign .pkg-stamp { width:150px; height:auto; display:block; margin:8px 0 2px; } .pkg-sign .line { border-top:1px solid #1a1a2e; width:260px; margin-top:6px; padding-top:4px; }
    .pkg-part p { font-size:14px; line-height:1.55; }
    @media print { .pkg-toc { display:none; } body { background:#fff; } }
  </style>`;
}

function reportPart(input: PackageInput): string {
  return `<div class="pkg-part" id="report"><section><h2 class="part">1. SEO Report</h2></section>${customerReportBody(input.run, input.tasks, input.evidence, input.pages ?? [])}</div>`;
}

// Target goal achievement M0..M12 (agreed milestones). A milestone month is where the target steps up; the months in
// between hold the last target. M0 is the baseline (today's measured value); M11-M12 hold the final target.
const GOAL_DA: Record<number, number> = { 1: 20, 2: 30, 3: 40, 5: 50, 7: 60, 9: 70 };
const GOAL_DR: Record<number, number> = { 1: 20, 2: 30, 4: 40, 6: 50, 8: 60, 10: 70 };

function measured(evidence: AuditEvidence[], key: 'da' | 'dr'): number | null {
  try {
    const row = collectMetrics(evidence).find((r) => r.key === key);
    for (const c of row?.cells ?? []) {
      const n = parseMetric(c.value);
      if (n != null) return n;
    }
  } catch {
    /* no usable evidence */
  }
  return null;
}

function goalTable(monthIndex: number | null, evidence: AuditEvidence[]): string {
  const actualDa = measured(evidence, 'da');
  const actualDr = measured(evidence, 'dr');
  let da = 0;
  let dr = 0;
  const rows: string[] = [];
  for (let m = 0; m <= 12; m++) {
    const newDa = GOAL_DA[m] != null;
    const newDr = GOAL_DR[m] != null;
    if (newDa) da = GOAL_DA[m];
    if (newDr) dr = GOAL_DR[m];
    const isNow = monthIndex === m;
    const cell = (v: number, isNew: boolean, actual: number | null) => {
      if (m === 0) return `<td>${actual != null ? 'Baseline ' + actual : 'Baseline'}</td>`;
      const tag = isNow && actual != null ? ` <span class="${actual >= v ? 'ok' : 'wait'}">${actual >= v ? '&#10003; achieved' : 'now ' + actual}</span>` : '';
      return `<td class="${isNew ? 'new' : 'hold'}">${v}${tag}</td>`;
    };
    rows.push(`<tr class="${isNow ? 'now' : ''}"><td>M${m}${isNow ? ' (this month)' : ''}</td>${cell(da, newDa, actualDa)}${cell(dr, newDr, actualDr)}</tr>`);
  }
  return `<h3>Target goal achievement (M0 &ndash; M12)</h3>
    <table class="pkg-goal"><thead><tr><th>Month</th><th>Domain Authority (DA) target</th><th>Domain Rating (DR) target</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="pkg-note">Bold = the month the target steps up; grey = the previous target is held. M0 is today's baseline. Targets are goals, not guarantees (see Terms &amp; Conditions, section 4).</p>`;
}

function strategyPart(s: Strategy, monthIndex: number | null, evidence: AuditEvidence[]): string {
  const targets = SCOPE_TARGETS.map((t) => {
    const note = s.targets.find((x) => x.label === t.label)?.note ?? '';
    return `<div class="pkg-target"><div class="lab">${e(t.label)}</div><div class="big">${e(t.target)}</div>${note ? `<div class="pkg-note">${e(note)}</div>` : ''}</div>`;
  }).join('');
  const priorities = s.priorities
    .map(
      (p) => `<div class="pkg-card">${p.when ? `<span class="when">${e(p.when)}</span>` : ''}<div class="area">${e(p.area)}</div><h3>${e(p.title)}</h3>${p.why ? `<p>${e(p.why)}</p>` : ''}${ul(p.actions)}</div>`,
    )
    .join('');
  const plan = s.plan
    .map((w) => `<div class="pkg-card"><h3>${e(w.period)}${w.focus ? ` &mdash; ${e(w.focus)}` : ''}</h3>${ul(w.actions)}</div>`)
    .join('');
  return `<div class="pkg-part" id="strategy"><section>
    <h2 class="part">2. SEO Strategy</h2>
    <p>${e(s.executiveSummary)}</p>
    ${s.currentPosition.length ? `<h3>Where you stand today</h3>${ul(s.currentPosition)}` : ''}
    <h3>Targets</h3><div class="pkg-targets">${targets}</div>
    <p class="pkg-note">Targets are goals we work towards. They are not guarantees (see Terms &amp; Conditions, section 4).</p>
    ${goalTable(monthIndex, evidence)}
    <h3>Priorities</h3>${priorities}
    ${plan ? `<h3>Action plan</h3>${plan}` : ''}
    ${s.kpis.length ? `<h3>How we measure progress</h3>${ul(s.kpis)}` : ''}
    ${s.risks.length ? `<h3>Risks to watch</h3>${ul(s.risks)}` : ''}
  </section></div>`;
}

function deliverablesPart(monthIndex: number | null): string {
  const monthNote = monthDeliverableNote(monthIndex);
  const sections = SCOPE_SECTIONS.map(
    (s) => `<div class="pkg-card"><h3>${e(s.title)}</h3><ul>${s.items
      .map((i) => `<li><strong>${e(i.title)}:</strong> ${e(i.text)}${i.note ? ` <em>(${e(i.note)})</em>` : ''}</li>`)
      .join('')}</ul>${s.note ? `<p class="pkg-note">${e(s.note)}</p>` : ''}</div>`,
  ).join('');
  const extras = SCOPE_EXTRA_SERVICES.map((i) => `<li><strong>${e(i.title)}:</strong> ${e(i.text)}</li>`).join('');
  return `<div class="pkg-part" id="deliverables"><section>
    <h2 class="part">3. Deliverables</h2>
    ${monthNote ? `<p><strong>${e(monthNote)}</strong></p>` : ''}
    ${sections}
    <div class="pkg-card"><h3>Extra services (available on additional charges)</h3><ul>${extras}</ul></div>
    <p class="pkg-note">${e(SCOPE_PLATFORM_NOTE)}</p>
  </section></div>`;
}

// e.g. "28 Oct 2026, 16:12 IST" in the business timezone (APP_TIMEZONE, default Asia/Kolkata).
function stampDateTime(d: Date): string {
  const tz = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  const text = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const abbr = tz === 'Asia/Kolkata' ? 'IST' : tz;
  return `${text} ${abbr}`;
}

function termsPart(signedAt: Date): string {
  const blocks = TERMS.map(
    (t) => `<h3>${e(t.heading)}</h3>${t.intro ? `<p>${e(t.intro)}</p>` : ''}${t.bullets ? ul(t.bullets) : ''}${t.note ? `<p class="pkg-note">${e(t.note)}</p>` : ''}`,
  ).join('');
  return `<div class="pkg-part pkg-terms" id="terms"><section>
    <h2 class="part">4. Terms &amp; Conditions for SEO Services</h2>
    <p>${e(TERMS_INTRO)}</p>${blocks}
    <div class="pkg-sign">For Openink Hub<br><img class="pkg-stamp" src="${STAMP_DATA_URI}" alt="Openink Hub stamp"><div class="line">Date &amp; time: ${e(stampDateTime(signedAt))}</div></div>
  </section></div>`;
}

// ONE customer document: cover -> SEO Report -> Strategy -> Deliverables -> Terms & Conditions.
export function buildPackageHtml(input: PackageInput): string {
  const date = formatDate(input.run.completedAt ?? input.run.createdAt);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Openink Hub — SEO Report &amp; Strategy — ${e(input.customerName)}</title>
${styleBlock()}
${packageStyle()}
</head>
<body>
  ${input.preview ? '<div class="pkg-preview">PREVIEW — not yet compiled. The customer cannot see this until the package is compiled.</div>' : ''}
  <header class="pkg-cover"><div class="inner">
    <div class="brand-mark">Openink Hub</div>
    <h1>SEO Report &amp; Strategy</h1>
    <p class="sub">${e(input.customerName)} &middot; ${e(input.website)}${input.monthCode ? ` &middot; ${e(input.monthCode)}` : ''} &middot; ${e(date)}</p>
  </div></header>
  <nav class="pkg-toc"><a href="#report">1. SEO Report</a><a href="#strategy">2. SEO Strategy</a><a href="#deliverables">3. Deliverables</a><a href="#terms">4. Terms &amp; Conditions</a></nav>
  ${reportPart(input)}
  ${strategyPart(input.strategy, input.monthIndex, input.evidence)}
  ${deliverablesPart(input.monthIndex)}
  ${termsPart(input.signedAt ?? new Date())}
  <footer class="brand-footer">${e(COMPANY_FOOTER)}</footer>
</body>
</html>`;
}

export function pendingCustomerPageHtml(customerName: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Openink Hub — SEO Report</title>${styleBlock()}</head><body>
  <header class="brand-header"><div class="brand-mark">Openink Hub</div><h1>SEO Report &amp; Strategy</h1><p class="meta">${e(customerName)}</p></header>
  <section><div class="layer-card"><h3>Your report is being prepared</h3><p>Our team is completing your SEO audit and strategy. It will appear here as soon as it is ready.</p></div></section>
  <footer class="brand-footer">${e(COMPANY_FOOTER)}</footer></body></html>`;
}
