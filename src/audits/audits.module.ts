import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRun } from './audit-run.entity';
import { AuditTask } from './audit-task.entity';
import { LayerPush } from './layer-push.entity';
import { AuditsService } from './audits.service';
import { AuditsController } from './audits.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditRun, AuditTask, LayerPush]),
    CustomersModule,
  ],
  providers: [AuditsService],
  controllers: [AuditsController],
})
export class AuditsModule {}
