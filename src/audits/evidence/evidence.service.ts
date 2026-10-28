import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AuditEvidence } from './audit-evidence.entity';
import { AuditsService } from '../audits.service';
import { StorageService } from '../../page-images/storage.service';
import { looksLikeDigispot, parseDigispotReport } from './digispot-parser';
import { looksLikePpcBlogPro, parsePpcBlogProCsv } from './ppcblogpro-parser';
import { extractFromImage, extractorConfigured } from './evidence-extractor';
import { KNOWN_TYPES, TOOL_SECTIONS } from './aitdk-rules';
import { UpdateEvidenceDto } from './evidence.dto';

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const FOLDER = 'audit-evidence';

// Never send the stored text export back in list responses (it can be large).
function publicView(e: AuditEvidence): Omit<AuditEvidence, 'textContent'> & { hasText: boolean } {
  const { textContent, ...rest } = e;
  return { ...rest, hasText: !!textContent };
}

@Injectable()
export class EvidenceService {
  constructor(
    @InjectRepository(AuditEvidence) private readonly repo: Repository<AuditEvidence>,
    private readonly audits: AuditsService,
    private readonly storage: StorageService,
  ) {}

  status() {
    return { readerConfigured: extractorConfigured(), storage: this.storage.backend(), sections: TOOL_SECTIONS };
  }

  async list(customerId: string, runId: string) {
    await this.audits.findOne(customerId, runId);
    const rows = await this.repo.find({ where: { customerId, auditRunId: runId }, order: { createdAt: 'ASC' } });
    return rows.map(publicView);
  }

  // Staging only: the file is stored and queued. Nothing is read and no report is rebuilt until
  // the admin presses Complete (processNext + rebuild-report).
  async upload(customerId: string, runId: string, file: Express.Multer.File, section?: string) {
    await this.audits.findOne(customerId, runId);
    const isText = /^text\//.test(file.mimetype) || /\.(txt|csv)$/i.test(file.originalname);
    const isImage = IMAGE_MIME.includes(file.mimetype);
    if (!isText && !isImage) throw new BadRequestException('Upload a PNG/JPEG/WebP screenshot, a PDF, a .txt report or a .csv export.');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const dup = await this.repo.findOne({ where: { auditRunId: runId, sha256 } });
    if (dup) throw new BadRequestException(`"${file.originalname}" is already uploaded for this audit.`);

    const row = this.repo.create({
      customerId,
      auditRunId: runId,
      kind: isText ? 'text' : 'image',
      fileName: file.originalname.slice(0, 250),
      sha256,
      section: TOOL_SECTIONS.some((t) => t.key === section) ? (section as string) : 'other',
      tool: 'unknown',
      evidenceType: 'unknown',
      status: 'uploaded',
      includeInReport: true,
    });

    if (isText) {
      row.textContent = file.buffer.toString('utf8');
    } else {
      const stored = await this.storage.put(customerId, file.originalname, file.buffer, file.mimetype, FOLDER);
      row.url = stored.url;
      row.storageKey = stored.storageKey;
    }
    const saved = await this.repo.save(row);
    return publicView(saved);
  }

  // Complete, step 1: read the next few queued files. The panel calls this until remaining is 0
  // (keeps each request short for the host's proxy), then calls rebuild-report.
  async processNext(customerId: string, runId: string, batch = 2) {
    await this.audits.findOne(customerId, runId);
    const queued = await this.repo.find({ where: { customerId, auditRunId: runId, status: 'uploaded' }, order: { createdAt: 'ASC' }, take: batch });
    let ok = 0, failed = 0;
    for (const row of queued) {
      try {
        await this.readRow(row);
      } catch (err) {
        row.status = 'failed';
        row.error = err instanceof Error ? err.message : 'Could not read this file.';
      }
      if (row.status === 'failed') failed++; else ok++;
      await this.repo.save(row);
    }
    const remaining = await this.repo.count({ where: { customerId, auditRunId: runId, status: 'uploaded' } });
    return { processed: queued.length, ok, failed, remaining };
  }

  private async readRow(row: AuditEvidence): Promise<void> {
    if (row.kind === 'text') {
      this.applyText(row);
      return;
    }
    if (!row.url || !/^https?:\/\//i.test(row.url)) throw new BadRequestException('The stored file is not reachable. Upload it again.');
    const res = await fetch(row.url);
    if (!res.ok) throw new BadRequestException(`Could not fetch the stored file (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0] || (/\.pdf$/i.test(row.fileName) ? 'application/pdf' : 'image/png');
    await this.applyImage(row, buf, mime);
  }

  // Text exports are read by fixed rules, so they are trusted and approved straight away.
  private applyText(row: AuditEvidence): void {
    const text = row.textContent ?? '';
    if (looksLikeDigispot(text)) {
      const parsed = parseDigispotReport(text);
      row.tool = 'digispot';
      row.evidenceType = 'digispot_report';
      row.extracted = parsed as unknown as Record<string, any>;
      row.status = 'approved';
      row.error = null;
    } else if (looksLikePpcBlogPro(text)) {
      row.tool = 'ppcblogpro';
      row.evidenceType = 'ppcblogpro_report';
      row.extracted = parsePpcBlogProCsv(text) as unknown as Record<string, any>;
      row.status = 'approved';
      row.error = null;
    } else {
      row.status = 'failed';
      row.error = 'File format not recognised - supported: Digispot SEO Insights .txt and PPCBlogPro .csv exports.';
    }
  }

  // Screenshots are read by the vision model and wait for admin approval before customers see them.
  private async applyImage(row: AuditEvidence, buffer: Buffer, mime: string): Promise<void> {
    if (!extractorConfigured()) {
      row.status = 'failed';
      row.error = 'ANTHROPIC_API_KEY is not set on the server yet - the file is stored but not read. Add the key, then use Re-read.';
      return;
    }
    try {
      const out = await extractFromImage(buffer, mime, row.section && row.section !== 'other' ? row.section : null);
      row.evidenceType = out.type;
      row.tool = out.type.startsWith('aitdk_') ? 'aitdk' : out.type.startsWith('ppcblogpro_') ? 'ppcblogpro' : out.type.startsWith('seoanalyzer_') ? 'seoanalyzer' : out.type.startsWith('seoquake_') ? 'seoquake' : out.type.startsWith('mangools_') ? 'mangools' : out.type.startsWith('frase_') ? 'frase' : out.type.startsWith('seomator_') ? 'seomator' : 'unknown';
      row.extracted = out.data;
      row.status = 'extracted';
      row.error = null;
    } catch (err) {
      row.status = 'failed';
      row.error = err instanceof Error ? err.message : 'Could not read this screenshot.';
    }
  }

  private async get(customerId: string, runId: string, id: string): Promise<AuditEvidence> {
    const row = await this.repo.findOne({ where: { id, customerId, auditRunId: runId } });
    if (!row) throw new NotFoundException('Evidence item not found');
    return row;
  }

  async reextract(customerId: string, runId: string, id: string) {
    const row = await this.get(customerId, runId, id);
    await this.readRow(row);
    const saved = await this.repo.save(row);
    await this.audits.rebuildReports(customerId, runId);
    return publicView(saved);
  }

  async update(customerId: string, runId: string, id: string, dto: UpdateEvidenceDto) {
    const row = await this.get(customerId, runId, id);
    if (dto.evidenceType !== undefined) {
      if (!KNOWN_TYPES.has(dto.evidenceType)) throw new BadRequestException('Unknown evidence type.');
      row.evidenceType = dto.evidenceType;
    }
    if (dto.extractedJson !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(dto.extractedJson);
      } catch {
        throw new BadRequestException('The data is not valid JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BadRequestException('The data must be a JSON object.');
      }
      row.extracted = parsed as Record<string, any>;
      if (row.status === 'failed' || row.status === 'uploaded') row.status = 'extracted';
    }
    if (dto.status !== undefined) {
      if (!row.extracted) throw new BadRequestException('There is no extracted data to approve yet.');
      row.status = dto.status;
    }
    if (dto.includeInReport !== undefined) row.includeInReport = dto.includeInReport;
    const saved = await this.repo.save(row);
    await this.audits.rebuildReports(customerId, runId);
    return publicView(saved);
  }

  async getData(customerId: string, runId: string, id: string) {
    const row = await this.get(customerId, runId, id);
    return { id: row.id, evidenceType: row.evidenceType, extracted: row.extracted };
  }

  async remove(customerId: string, runId: string, id: string) {
    const row = await this.get(customerId, runId, id);
    if (row.kind === 'image') {
      const filename = (row.storageKey ?? row.url ?? '').split('/').pop() ?? '';
      await this.storage.remove(customerId, filename, row.storageKey, FOLDER);
    }
    await this.repo.remove(row);
    await this.audits.rebuildReports(customerId, runId);
    return { deleted: true };
  }
}
