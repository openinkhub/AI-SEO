import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { EvidenceService } from './evidence.service';
import { UpdateEvidenceDto } from './evidence.dto';
import { AuditsService } from '../audits.service';

const MAX_BYTES = 8 * 1024 * 1024;

// Admin-only (JWT). Screenshots and text exports attached to one SEO Audit run.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/audits/:runId')
export class EvidenceController {
  constructor(
    private readonly service: EvidenceService,
    private readonly audits: AuditsService,
  ) {}

  @Get('evidence-status')
  status() {
    return this.service.status();
  }

  @Get('evidence')
  list(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.list(customerId, runId);
  }

  @Post('evidence')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  upload(
    @Param('customerId') customerId: string,
    @Param('runId') runId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('section') section?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file").');
    return this.service.upload(customerId, runId, file, section);
  }

  @Post('evidence/process-next')
  processNext(@Param('customerId') customerId: string, @Param('runId') runId: string, @Body('retry') retry?: boolean) {
    return this.service.processNext(customerId, runId, 2, retry === true);
  }

  @Get('evidence/:id/data')
  data(@Param('customerId') customerId: string, @Param('runId') runId: string, @Param('id') id: string) {
    return this.service.getData(customerId, runId, id);
  }

  @Post('evidence/:id/extract')
  reextract(@Param('customerId') customerId: string, @Param('runId') runId: string, @Param('id') id: string) {
    return this.service.reextract(customerId, runId, id);
  }

  @Patch('evidence/:id')
  update(
    @Param('customerId') customerId: string,
    @Param('runId') runId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEvidenceDto,
  ) {
    return this.service.update(customerId, runId, id, dto);
  }

  @Delete('evidence/:id')
  remove(@Param('customerId') customerId: string, @Param('runId') runId: string, @Param('id') id: string) {
    return this.service.remove(customerId, runId, id);
  }

  // Rebuilds both reports from the run's tasks plus its current evidence.
  @Post('rebuild-report')
  async rebuild(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    await this.audits.rebuildReports(customerId, runId);
    return { rebuilt: true };
  }
}
