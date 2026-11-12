import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { Customer } from '../customers/customer.entity';
import { CustomerApisModule } from '../customer-apis/customer-apis.module';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { ProjectLayer } from './project-layer.entity';
import { LayersService } from './layers.service';
import { LayersController } from './layers.controller';
import { Layer4Keyword, Layer4Platform } from './layer4.entities';
import { Layer4Service } from './layer4.service';
import { Layer4Controller } from './layer4.controller';
import { WpLayer4Controller } from './wp-layer4.controller';
import { Layer5Platform, Layer5Prompt } from './layer5.entities';
import { Layer5Service } from './layer5.service';
import { Layer5Controller } from './layer5.controller';
import { WpLayer5Controller } from './wp-layer5.controller';
import { Layer6Keyword, Layer6Platform } from './layer6.entities';
import { Layer6Service } from './layer6.service';
import { Layer6Controller } from './layer6.controller';
import { WpLayer6Controller } from './wp-layer6.controller';
import { Layer7Question, Layer7State } from './layer7.entities';
import { Layer7Service } from './layer7.service';
import { Layer7Controller } from './layer7.controller';
import { WpLayer7Controller } from './wp-layer7.controller';
import { LayerAutomation } from './layer-automation';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectLayer, Project, Customer, Layer4Keyword, Layer4Platform, Layer5Prompt, Layer5Platform, Layer6Keyword, Layer6Platform, Layer7Question, Layer7State]), CustomerApisModule],
  providers: [LayersService, Layer4Service, Layer5Service, Layer6Service, Layer7Service, LayerAutomation, WpApiKeyGuard],
  controllers: [LayersController, Layer4Controller, WpLayer4Controller, Layer5Controller, WpLayer5Controller, Layer6Controller, WpLayer6Controller, Layer7Controller, WpLayer7Controller],
  exports: [LayersService, Layer4Service, Layer5Service, Layer6Service, Layer7Service],
})
export class LayersModule {}
