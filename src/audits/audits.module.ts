import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRun } from './audit-run.entity';
import { AuditTask } from './audit-task.entity';
import { LayerPush } from './layer-push.entity';
import { AuditsService } from './audits.service';
import { AuditsController } from './audits.controller';
import { CustomersModule } from '../customers/customers.module';
import { Customer } from '../customers/customer.entity';
import { MulterModule } from '@nestjs/platform-express';
import { PageImagesModule } from '../page-images/page-images.module';
import { AuditEvidence } from './evidence/audit-evidence.entity';
import { EvidenceService } from './evidence/evidence.service';
import { EvidenceController } from './evidence/evidence.controller';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { WpAuditsController } from './wp-audits.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditRun, AuditTask, LayerPush, Customer, AuditEvidence]),
    CustomersModule,
    PageImagesModule,
    MulterModule.register({}),
  ],
  providers: [AuditsService, EvidenceService, WpApiKeyGuard],
  controllers: [AuditsController, EvidenceController, WpAuditsController],
})
export class AuditsModule {}
