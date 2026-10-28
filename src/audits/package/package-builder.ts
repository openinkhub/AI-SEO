import { AuditRun } from '../audit-run.entity';
import { AuditTask } from '../audit-task.entity';
import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { customerReportBody, escapeHtml, formatDate, styleBlock } from '../report-builder';
import { Strategy } from './strategy-generator';
import {
  COMPANY_FOOTER,
  SCOPE_EXTRA_SERVICES,
  SCOPE_PLATFORM_NOTE,
  SCOPE_SECTIONS,
  SCOPE_TARGETS,
  TERMS,
  TERMS_INTRO,
  TERMS_SIGNED_DATE,
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
  strategy: Strategy;
  preview?: boolean;
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
    .pkg-note { font-size:13px; color:#5b5b6e; font-style:italic; margin:6px 0 0; }
    .pkg-preview { background:#fff7e0; border-bottom:1px solid #e8d48a; color:#6b5200; padding:10px 24px; font-size:14px; text-align:center; font-weight:600; }
    .pkg-terms h3 { margin:16px 0 4px; font-size:15px; } .pkg-terms p { font-size:13.5px; line-height:1.55; margin:4px 0; }
    .pkg-sign { margin-top:28px; font-size:14px; } .pkg-sign .line { border-top:1px solid #1a1a2e; width:260px; margin-top:34px; padding-top:4px; }
    .pkg-part p { font-size:14px; line-height:1.55; }
    @media print { .pkg-toc { display:none; } body { background:#fff; } }
  </style>`;
}

function reportPart(input: PackageInput): string {
  return `<div class="pkg-part" id="report"><section><h2 class="part">1. SEO Report</h2></section>${customerReportBody(input.run, input.tasks, input.evidence)}</div>`;
}

function strategyPart(s: Strategy): string {
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

function termsPart(): string {
  const blocks = TERMS.map(
    (t) => `<h3>${e(t.heading)}</h3>${t.intro ? `<p>${e(t.intro)}</p>` : ''}${t.bullets ? ul(t.bullets) : ''}${t.note ? `<p class="pkg-note">${e(t.note)}</p>` : ''}`,
  ).join('');
  return `<div class="pkg-part pkg-terms" id="terms"><section>
    <h2 class="part">4. Terms &amp; Conditions for SEO Services</h2>
    <p>${e(TERMS_INTRO)}</p>${blocks}
    <div class="pkg-sign">For Openink Hub<div class="line">Date: ${e(TERMS_SIGNED_DATE)}</div></div>
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
  ${strategyPart(input.strategy)}
  ${deliverablesPart(input.monthIndex)}
  ${termsPart()}
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
