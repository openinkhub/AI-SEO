import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/customer.entity';
import { HistoricalRecord } from './historical-record.entity';
import { ImportRun } from './import-run.entity';
import { WpApiKeyGuard } from './wp-api-key.guard';
import { WpClientService } from './wp-client.service';
import { WpIntegrationService } from './wp-integration.service';
import {
  WpSyncController,
  HistoricalImportController,
} from './wp-integration.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, HistoricalRecord, ImportRun])],
  controllers: [WpSyncController, HistoricalImportController],
  providers: [WpApiKeyGuard, WpClientService, WpIntegrationService],
  exports: [WpClientService],
})
export class WpIntegrationModule {}
