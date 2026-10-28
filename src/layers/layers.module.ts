import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { Customer } from '../customers/customer.entity';
import { CustomerApisModule } from '../customer-apis/customer-apis.module';
import { ProjectLayer } from './project-layer.entity';
import { LayersService } from './layers.service';
import { LayersController } from './layers.controller';
import { Layer4Keyword, Layer4Platform } from './layer4.entities';
import { Layer4Service } from './layer4.service';
import { Layer4Controller } from './layer4.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectLayer, Project, Customer, Layer4Keyword, Layer4Platform]), CustomerApisModule],
  providers: [LayersService, Layer4Service],
  controllers: [LayersController, Layer4Controller],
  exports: [LayersService, Layer4Service],
})
export class LayersModule {}
