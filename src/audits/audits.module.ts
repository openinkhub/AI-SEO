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
import { WpClientService } from '../wp-integration/wp-client.service';
import { CustomerApisModule } from '../customer-apis/customer-apis.module';
import { WpAuditsController } from './wp-audits.controller';
import { Project } from '../projects/project.entity';
import { AuditPackage } from './package/audit-package.entity';
import { PackageService } from './package/package.service';
import { PackageController } from './package/package.controller';
import { WebsitePage } from '../page-images/website-page.entity';
import { EmailModule } from '../email/email.module';
import { LibraryImage } from '../page-images/library-image.entity';
import { LayersModule } from '../layers/layers.module';
import { AuditAutomation } from './audit-automation';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditRun, AuditTask, LayerPush, Customer, AuditEvidence, Project, AuditPackage, WebsitePage, LibraryImage]),
    CustomersModule,
    EmailModule,
    CustomerApisModule,
    LayersModule,
    PageImagesModule,
    MulterModule.register({}),
  ],
  providers: [AuditsService, EvidenceService, PackageService, WpApiKeyGuard, WpClientService, AuditAutomation],
  controllers: [AuditsController, EvidenceController, PackageController, WpAuditsController],
})
export class AuditsModule {}
