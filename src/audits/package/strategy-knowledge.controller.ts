import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { GEO_FACTS } from './geo-knowledge';
import { FINAL_GOAL, internalTargets } from './goals';
import { AGENT_GOALS } from './agent-readiness';
import { PROMPT_LIBRARY, ROADMAP_EXPECTATIONS, ROADMAP_KPIS, ROADMAP_PHASES, ROADMAP_WORKSTREAMS } from './ai-roadmap';

// Admin dashboard > Strategy: the AI-search knowledge base that is fed into every monthly SEO Strategy.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/strategy-knowledge')
export class StrategyKnowledgeController {
  @Get()
  list() {
    // Confidential month-by-month DA / DR plan (never shown to customers): M0 = baseline, M1..M12 = target for that month.
    const targets = Array.from({ length: 13 }, (_, m) => ({ month: m, ...internalTargets(m) }));
    return { facts: GEO_FACTS, agentGoals: AGENT_GOALS, targets: { months: targets, finalGoal: FINAL_GOAL }, roadmap: { phases: ROADMAP_PHASES, workstreams: ROADMAP_WORKSTREAMS, kpis: ROADMAP_KPIS, expectations: ROADMAP_EXPECTATIONS, prompts: PROMPT_LIBRARY } };
  }
}
