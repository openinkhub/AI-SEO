import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { ProjectLayer } from './project-layer.entity';
import { LayersService } from './layers.service';
import { LayersController } from './layers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectLayer, Project])],
  providers: [LayersService],
  controllers: [LayersController],
  exports: [LayersService],
})
export class LayersModule {}
