import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerApiSetting } from './customer-api-setting.entity';
import { Customer } from '../customers/customer.entity';
import { CustomerApisService } from './customer-apis.service';
import { CustomerApisController } from './customer-apis.controller';
import { GlobalApiSetting } from './global-api-setting.entity';
import { GlobalApisService } from './global-apis.service';
import { GlobalApisController } from './global-apis.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerApiSetting, GlobalApiSetting, Customer])],
  providers: [CustomerApisService, GlobalApisService],
  controllers: [CustomerApisController, GlobalApisController],
  exports: [CustomerApisService, GlobalApisService],
})
export class CustomerApisModule {}
