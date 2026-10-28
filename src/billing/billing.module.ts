import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { Invoice } from './invoice.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { CustomersModule } from '../customers/customers.module';
import { ProjectsModule } from '../projects/projects.module';
import { PageImagesModule } from '../page-images/page-images.module';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { WpInvoicesController } from './wp-invoices.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Customer]),
    MulterModule.register({}),
    CustomersModule,
    ProjectsModule,
    PageImagesModule, // exports StorageService (Cloudflare R2)
  ],
  providers: [BillingService, WpApiKeyGuard],
  controllers: [BillingController, WpInvoicesController],
})
export class BillingModule {}
