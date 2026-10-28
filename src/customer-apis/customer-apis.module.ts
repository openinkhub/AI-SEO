import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerApiSetting } from './customer-api-setting.entity';
import { Customer } from '../customers/customer.entity';
import { CustomerApisService } from './customer-apis.service';
import { CustomerApisController } from './customer-apis.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerApiSetting, Customer])],
  providers: [CustomerApisService],
  controllers: [CustomerApisController],
  exports: [CustomerApisService],
})
export class CustomerApisModule {}
