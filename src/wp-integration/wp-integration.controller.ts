import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WpApiKeyGuard } from './wp-api-key.guard';
import { WpIntegrationService } from './wp-integration.service';
import { WpSyncCustomerDto } from './dto/wp-sync-customer.dto';
import { WpSyncHistoryDto } from './dto/wp-sync-history.dto';

// Incoming WP -> Engine routes (WpApiKeyGuard, shared API key header) -
// what the KP21 plugin's new wp_remote_post client will call.
@Controller('api/v1/wp-sync')
@UseGuards(WpApiKeyGuard)
export class WpSyncController {
  constructor(private readonly service: WpIntegrationService) {}

  @Post('customers')
  upsertCustomer(@Body() dto: WpSyncCustomerDto) {
    return this.service.upsertFromWp(dto);
  }

  @Post('history')
  importHistory(@Body() dto: WpSyncHistoryDto) {
    return this.service.importHistory(dto);
  }

  @Get('customers/:wpUserId')
  getByWpUserId(@Param('wpUserId') wpUserId: string) {
    return this.service.findCustomerByWpUserId(wpUserId);
  }
}

// Admin-triggered routes (JWT guard, same as every other Engine module)
// for the historical-import scaffold (decision 5).
@Controller('api/v1/historical-import')
@UseGuards(JwtAuthGuard)
export class HistoricalImportController {
  constructor(private readonly service: WpIntegrationService) {}

  @Post('run')
  run(@Body('wpUserId') wpUserId?: string) {
    return this.service.runHistoricalImport(wpUserId);
  }

  @Get('runs')
  listRuns() {
    return this.service.listImportRuns();
  }
}
