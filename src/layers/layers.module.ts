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
import { Layer8Item, Layer8Platform } from './layer8.entities';
import { Layer8Service } from './layer8.service';
import { Layer8Controller } from './layer8.controller';
import { WpLayer8Controller } from './wp-layer8.controller';
import { Layer9Faq, Layer9Platform } from './layer9.entities';
import { Layer9Service } from './layer9.service';
import { Layer9Controller } from './layer9.controller';
import { WpLayer9Controller } from './wp-layer9.controller';
import { Layer10Platform, Layer10Quora } from './layer10.entities';
import { Layer10Service } from './layer10.service';
import { Layer10Controller } from './layer10.controller';
import { WpLayer10Controller } from './wp-layer10.controller';
import { Layer11Record } from './layer11.entities';
import { Layer11Service } from './layer11.service';
import { Layer11Controller, WpLayer11Controller } from './layer11.controller';
import { LayerAutomation } from './layer-automation';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectLayer, Project, Customer, Layer4Keyword, Layer4Platform, Layer5Prompt, Layer5Platform, Layer6Keyword, Layer6Platform, Layer7Question, Layer7State, Layer8Item, Layer8Platform, Layer9Faq, Layer9Platform, Layer10Quora, Layer10Platform, Layer11Record]), CustomerApisModule],
  providers: [LayersService, Layer4Service, Layer5Service, Layer6Service, Layer7Service, Layer8Service, Layer9Service, Layer10Service, Layer11Service, LayerAutomation, WpApiKeyGuard],
  controllers: [LayersController, Layer4Controller, WpLayer4Controller, Layer5Controller, WpLayer5Controller, Layer6Controller, WpLayer6Controller, Layer7Controller, WpLayer7Controller, Layer8Controller, WpLayer8Controller, Layer9Controller, WpLayer9Controller, Layer10Controller, WpLayer10Controller, Layer11Controller, WpLayer11Controller],
  exports: [LayersService, Layer4Service, Layer5Service, Layer6Service, Layer7Service, Layer8Service, Layer9Service, Layer10Service, Layer11Service],
})
export class LayersModule {}
