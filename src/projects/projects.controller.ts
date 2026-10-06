import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }

  // "Ensure M0 & M1 exist" — the one-click Months-tab action per the
  // 2026-10-06 decision. Idempotent.
  @Post('ensure-m0-m1')
  ensureM0M1(@Param('customerId') customerId: string) {
    return this.service.ensureMonths(customerId);
  }

  @Post()
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.service.create(customerId, dto);
  }

  @Patch(':id')
  update(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.update(customerId, id, dto);
  }

  @Delete(':id')
  remove(@Param('customerId') customerId: string, @Param('id') id: string) {
    return this.service.remove(customerId, id);
  }
}
