import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { EvidenceService } from './evidence.service';
import { UpdateEvidenceDto } from './evidence.dto';
import { AuditsService } from '../audits.service';
import { pageAuditCsv, pageAuditHtmlDoc } from './page-audit-render';

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

  // One row per page and parameter (plus the root domain), for Excel / Google Sheets.
  @Get('page-audit.csv')
  async pageAuditCsv(@Param('customerId') customerId: string, @Param('runId') runId: string, @Res() res: any) {
    const { root, chunks } = await this.service.pageAudit(customerId, runId);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="seo-audit-page-wise.csv"' });
    res.send(pageAuditCsv(root, chunks));
  }

  // The full page-wise report as one stand-alone HTML page (every page expanded, ready to print or share).
  @Get('page-audit.html')
  async pageAuditHtml(@Param('customerId') customerId: string, @Param('runId') runId: string, @Res() res: any) {
    const { root, chunks } = await this.service.pageAudit(customerId, runId);
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(pageAuditHtmlDoc(root, chunks));
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
