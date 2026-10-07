import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { ProjectsModule } from '../projects/projects.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [TypeOrmModule.forFeature([Customer]), ProjectsModule, OnboardingModule],
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
