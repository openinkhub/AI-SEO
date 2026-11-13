import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LayersService } from './layers.service';
import { Layer4Service } from './layer4.service';
import { Layer5Service } from './layer5.service';
import { Layer6Service } from './layer6.service';
import { Layer7Service } from './layer7.service';
import { Layer8Service } from './layer8.service';
import { Layer9Service } from './layer9.service';
import { Layer10Service } from './layer10.service';
import { ConsolidationService } from './consolidation.service';
import { Layer11Service } from './layer11.service';

// AUTOMATION RULE (decided 2026-10-28): a Layer that is automated runs on its SET DATE only - the scheduled date
// of its row in the customer's Month Cycle (Layer 4 = Day 4, Layer 5 = Day 5, Layer 6 = Day 6, Layer 7 = Day 7, Layer 8 = Day 8, Layer 9 = Day 9, Layer 10 = Day 10 of the month, M0..M12). It does not run early and does
// not back-fill missed days (a deploy must never trigger a burst of paid API calls for past dates).
//  - Window: from LAYER_AUTOMATION_START_HOUR (default 01:00, APP_TIMEZONE) until the end of that day, checked every 10 minutes.
//  - Order: platform by platform (ChatGPT, Gemini, Perplexity, Claude, Grok, DeepSeek, Meta AI, Google AI), every due
//    customer on one platform before the next platform; one call at a time, >= 3 s between two calls to the same provider.
//  - Skipped: Manual platforms (Copilot), platforms already holding 10 keywords, platforms already attempted today.
//  - Result: the Layer row becomes "done" when all 9 platforms hold 10 keywords, otherwise "in progress".
//  - Switch off with LAYER_AUTOMATION=off.
export const AUTOMATED_LAYERS: number[] = [4, 5, 6, 7, 8, 9, 10, 11];

const tick_ms = 10 * 60 * 1000;
const tz = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date());
const hourNow = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', hour12: false }).format(new Date()), 10) % 24;

@Injectable()
export class LayerAutomation implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('LayerAutomation');
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly layers: LayersService, private readonly layer4: Layer4Service, private readonly layer5: Layer5Service, private readonly layer6: Layer6Service, private readonly layer7: Layer7Service, private readonly layer8: Layer8Service, private readonly layer9: Layer9Service, private readonly layer10: Layer10Service, private readonly consolidation: ConsolidationService, private readonly layer11: Layer11Service) {}

  onModuleInit() {
    if ((process.env.LAYER_AUTOMATION || '').toLowerCase() === 'off') {
      this.log.warn('Layer automation is switched off (LAYER_AUTOMATION=off).');
      return;
    }
    this.timer = setInterval(() => void this.tick(), tick_ms);
    this.first = setTimeout(() => void this.tick(), 90 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  async tick() {
    if (this.busy) return;
    // Consolidation: consolidate any Layer 4-10 table that is complete but not yet consolidated (free, local, any hour).
    try {
      const built = await this.consolidation.sweep();
      if (built) this.log.log('Consolidation: ' + built + ' block(s).');
    } catch (err) {
      this.log.error('Consolidation sweep: ' + (err instanceof Error ? err.message : err));
    }
    const start = parseInt(process.env.LAYER_AUTOMATION_START_HOUR || '1', 10);
    if (hourNow() < (isNaN(start) ? 1 : start)) return;
    this.busy = true;
    try {
      for (const layerNo of AUTOMATED_LAYERS) {
        const due = await this.layers.dueRows(layerNo, todayStr());
        if (!due.length) continue;
        if (layerNo === 4) {
          const out = await this.layer4.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 4 (${todayStr()}): ${out}`);
        } else if (layerNo === 5) {
          const out = await this.layer5.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 5 (${todayStr()}): ${out}`);
        } else if (layerNo === 6) {
          const out = await this.layer6.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 6 (${todayStr()}): ${out}`);
        } else if (layerNo === 7) {
          const out = await this.layer7.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 7 (${todayStr()}): ${out}`);
        } else if (layerNo === 8) {
          const out = await this.layer8.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 8 (${todayStr()}): ${out}`);
        } else if (layerNo === 9) {
          const out = await this.layer9.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 9 (${todayStr()}): ${out}`);
        } else if (layerNo === 10) {
          const out = await this.layer10.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 10 (${todayStr()}): ${out}`);
        } else if (layerNo === 11) {
          const out = await this.layer11.runDay(due.map((r) => ({ customerId: r.customerId, monthIndex: r.monthIndex })));
          this.log.log(`Layer 11 (${todayStr()}): ${out}`);
        }
      }
    } catch (err) {
      this.log.error(`Layer automation: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.busy = false;
    }
  }
}
