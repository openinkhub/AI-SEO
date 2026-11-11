import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { GEO_FACTS } from './geo-knowledge';
import { PROMPT_LIBRARY, ROADMAP_EXPECTATIONS, ROADMAP_KPIS, ROADMAP_PHASES, ROADMAP_WORKSTREAMS } from './ai-roadmap';

// Admin dashboard > Strategy: the AI-search knowledge base that is fed into every monthly SEO Strategy.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/strategy-knowledge')
export class StrategyKnowledgeController {
  @Get()
  list() {
    return { facts: GEO_FACTS, roadmap: { phases: ROADMAP_PHASES, workstreams: ROADMAP_WORKSTREAMS, kpis: ROADMAP_KPIS, expectations: ROADMAP_EXPECTATIONS, prompts: PROMPT_LIBRARY } };
  }
}
