import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { Invoice } from './invoice.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { CustomersModule } from '../customers/customers.module';
import { ProjectsModule } from '../projects/projects.module';
import { PageImagesModule } from '../page-images/page-images.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice]),
    MulterModule.register({}),
    CustomersModule,
    ProjectsModule,
    PageImagesModule, // exports StorageService (Cloudflare R2)
  ],
  providers: [BillingService],
  controllers: [BillingController],
})
export class BillingModule {}
