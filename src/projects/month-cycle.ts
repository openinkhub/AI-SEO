import { ProjectStatus } from './project.entity';

// WP's Month Cycle rule, copied exactly (KP21_Admin month creation +
// KP21_Frontend ACT account date): the anchor is the customer's ACT
// authoritative date (admin override) or, if none, the account registration
// timestamp. cycle0 = the anchor's DATE + 1 day; Month m starts at
// cycle0 + m*30 days and ends 29 days after it (30-day cycles, M0..M12).
// e.g. registered 2026-08-06 19:30 -> M0 = 07 Aug..05 Sep 2026,
// M1 = 06 Sep..05 Oct 2026.
export const MONTH_COUNT = 13; // M0..M12, same as WP's ensure_full_month_cycles

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(base: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(base || '');
  if (!m) return null;
  return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function cycleDates(
  base: string,
  monthIndex: number,
): { start: string; end: string } | null {
  const baseMs = parseDate(base);
  if (baseMs === null) return null;
  const startMs = baseMs + DAY_MS * (1 + 30 * monthIndex);
  return { start: iso(startMs), end: iso(startMs + 29 * DAY_MS) };
}

// "Today" as a YYYY-MM-DD string in the business timezone (the WP site
// timezone is India; override with APP_TIMEZONE).
export function todayInTz(): string {
  const tz = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function statusForCycle(start: string, end: string, today: string): ProjectStatus {
  if (end < today) return ProjectStatus.COMPLETED;
  if (start > today) return ProjectStatus.PENDING;
  return ProjectStatus.ACTIVE;
}
