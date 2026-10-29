import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { collectMetrics, parseMetric } from '../evidence/metrics';

// INTERNAL TARGET TRACK (confidential). The month-by-month numbers below are NEVER printed in a customer document.
// They are used for two things only: (1) building the strategy (how hard to push this month) and (2) comparing
// the measured DA / DR of the month with the planned pace. The customer is only shown the final goal (FINAL_GOAL).
//
// A number is the target that STEPS UP in that month; the months in between hold the previous target. M0 is the
// baseline (no target). Source: the agreed DA / DR plan sheet (28 Oct 2026).
export const INTERNAL_DA_STEPS: Record<number, number> = { 1: 20, 2: 30, 3: 40, 5: 50, 7: 60, 9: 70 };
export const INTERNAL_DR_STEPS: Record<number, number> = { 1: 20, 2: 30, 4: 40, 6: 50, 8: 60, 10: 70 };

// What the customer is told: the goal to be achieved by this month.
export const FINAL_GOAL = { month: 10, da: 70, dr: 70 };

const targetAt = (steps: Record<number, number>, month: number): number | null => {
  if (month <= 0) return null; // M0 = baseline
  let t: number | null = null;
  for (let m = 1; m <= Math.min(month, 12); m++) if (steps[m] != null) t = steps[m];
  return t;
};

export interface GoalCheck {
  monthIndex: number;
  baseline: boolean;
  targetDa: number | null;
  targetDr: number | null;
  actualDa: number | null;
  actualDr: number | null;
  gapDa: number | null; // target - actual (positive = behind)
  gapDr: number | null;
  status: 'baseline' | 'no-data' | 'behind' | 'on-track' | 'ahead';
}

export function internalTargets(monthIndex: number): { da: number | null; dr: number | null } {
  return { da: targetAt(INTERNAL_DA_STEPS, monthIndex), dr: targetAt(INTERNAL_DR_STEPS, monthIndex) };
}

export function measuredAuthority(evidence: AuditEvidence[]): { da: number | null; dr: number | null } {
  const pick = (key: 'da' | 'dr'): number | null => {
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
  };
  return { da: pick('da'), dr: pick('dr') };
}

export function compareToGoal(monthIndex: number | null, actualDa: number | null, actualDr: number | null): GoalCheck | null {
  if (monthIndex == null) return null;
  const t = internalTargets(monthIndex);
  const gapDa = t.da != null && actualDa != null ? t.da - actualDa : null;
  const gapDr = t.dr != null && actualDr != null ? t.dr - actualDr : null;
  const gaps = [gapDa, gapDr].filter((g): g is number => g != null);
  let status: GoalCheck['status'];
  if (monthIndex <= 0) status = 'baseline';
  else if (!gaps.length) status = 'no-data';
  else if (gaps.some((g) => g > 0)) status = 'behind';
  else if (gaps.every((g) => g <= -5)) status = 'ahead';
  else status = 'on-track';
  return { monthIndex, baseline: monthIndex <= 0, targetDa: t.da, targetDr: t.dr, actualDa, actualDr, gapDa, gapDr, status };
}
