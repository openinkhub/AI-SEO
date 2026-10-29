import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LayersService } from '../layers/layers.service';
import { AuditsService } from './audits.service';

// AUTOMATION RULE (same as the other automated Layers): the SEO Audit (Layer 3) runs on its SET DATE only - Day 3 of
// each customer's Month Cycle, M0..M12 - using the same audit, report and research as the manual run. It never runs
// early, never back-fills missed days, runs once per cycle (the cycle rule in AuditsService.ruleStatus), and is not
// retried the same day after a failed attempt. One customer at a time, from LAYER_AUTOMATION_START_HOUR (default 01:00)
// until the end of the day, checked every 10 minutes. Switch off with LAYER_AUTOMATION=off.
const tick_ms = 10 * 60 * 1000;
const tz = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date());
const hourNow = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', hour12: false }).format(new Date()), 10) % 24;

@Injectable()
export class AuditAutomation implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AuditAutomation');
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly layers: LayersService, private readonly audits: AuditsService) {}

  onModuleInit() {
    if ((process.env.LAYER_AUTOMATION || '').toLowerCase() === 'off') return;
    this.timer = setInterval(() => void this.tick(), tick_ms);
    this.first = setTimeout(() => void this.tick(), 120 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  async tick() {
    if (this.busy) return;
    const start = parseInt(process.env.LAYER_AUTOMATION_START_HOUR || '1', 10);
    if (hourNow() < (isNaN(start) ? 1 : start)) return;
    this.busy = true;
    try {
      const due = await this.layers.dueRows(3, todayStr());
      for (const row of due) {
        try {
          if (await this.audits.attemptedToday(row.customerId)) continue;
          const rule = await this.audits.ruleStatus(row.customerId);
          if (!rule.canRun || !rule.unlocked || rule.monthIndex !== row.monthIndex) continue;
          await this.audits.createRun(row.customerId, {} as any);
          this.log.log('SEO Audit started for customer ' + row.customerId + ' (M' + row.monthIndex + ')');
        } catch (err) {
          this.log.error('SEO Audit automation, customer ' + row.customerId + ': ' + (err instanceof Error ? err.message : err));
        }
      }
    } catch (err) {
      this.log.error('SEO Audit automation: ' + (err instanceof Error ? err.message : err));
    } finally {
      this.busy = false;
    }
  }
}
