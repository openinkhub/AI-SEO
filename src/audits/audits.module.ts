import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRun } from './audit-run.entity';
import { AuditTask } from './audit-task.entity';
import { LayerPush } from './layer-push.entity';
import { AuditsService } from './audits.service';
import { AuditsController } from './audits.controller';
import { CustomersModule } from '../customers/customers.module';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { WpAuditsController } from './wp-audits.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditRun, AuditTask, LayerPush, Customer]),
    CustomersModule,
  ],
  providers: [AuditsService, WpApiKeyGuard],
  controllers: [AuditsController, WpAuditsController],
})
export class AuditsModule {}
