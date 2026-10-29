import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { GEO_FACTS } from './geo-knowledge';

// Admin dashboard > Strategy: the AI-search knowledge base that is fed into every monthly SEO Strategy.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/strategy-knowledge')
export class StrategyKnowledgeController {
  @Get()
  list() {
    return { facts: GEO_FACTS };
  }
}
