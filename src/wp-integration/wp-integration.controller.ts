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

  // Decided 2026-10-06: "Pull and sync real customer Data and profile
  // rows, so that we have not to create again." Admin-triggered,
  // idempotent — pulls every WP customer's profile from the new
  // KP21_Engine_Export route and merges it into the matching Customer.
  @Post('import-profiles')
  importProfiles() {
    return this.service.importWpCustomerProfiles();
  }

  @Get('runs')
  listRuns() {
    return this.service.listImportRuns();
  }
}
