import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, CustomerStatus } from '../customers/customer.entity';
import { HistoricalRecord } from './historical-record.entity';
import { ImportRun, ImportRunStatus } from './import-run.entity';
import { WpSyncCustomerDto } from './dto/wp-sync-customer.dto';
import { WpSyncHistoryDto } from './dto/wp-sync-history.dto';
import { WpClientService } from './wp-client.service';

@Injectable()
export class WpIntegrationService {
  private readonly logger = new Logger(WpIntegrationService.name);

  constructor(
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(HistoricalRecord)
    private historicalRecords: Repository<HistoricalRecord>,
    @InjectRepository(ImportRun) private importRuns: Repository<ImportRun>,
    private wpClient: WpClientService,
  ) {}

  // Decision 1 ("auto fetch" sync): upsert, matched by wpUserId. A WP
  // user re-posted after an edit updates the same Engine row rather than
  // creating a duplicate customer.
  async upsertFromWp(dto: WpSyncCustomerDto): Promise<Customer> {
    let customer = await this.customers.findOne({
      where: { wpUserId: dto.wpUserId },
    });

    if (!customer) {
      customer = this.customers.create({
        wpUserId: dto.wpUserId,
        source: 'wp_sync',
        status: CustomerStatus.ONBOARDING,
      });
    }

    customer.companyName = dto.companyName;
    customer.website = dto.website ?? customer.website ?? null;
    customer.industry = dto.industry ?? customer.industry ?? null;
    customer.contactName = dto.contactName ?? customer.contactName ?? null;
    customer.contactEmail = dto.contactEmail ?? customer.contactEmail ?? null;
    customer.contactPhone = dto.contactPhone ?? customer.contactPhone ?? null;
    customer.address = dto.address ?? customer.address ?? null;
    customer.competitors = dto.competitors ?? customer.competitors ?? null;

    const saved = await this.customers.save(customer);
    this.logger.log(`Synced customer from WP user ${dto.wpUserId} -> ${saved.id}`);

    // Best-effort: let WP know the sync landed, so it can send the
    // onboarding form. Never blocks/throws if WP isn't reachable yet.
    await this.wpClient.notifyOnboardingReady(dto.wpUserId);

    return saved;
  }

  // Decision 2 (history half): stores WP's historical rows as opaque
  // JSON against the matching customer, if one is already synced.
  async importHistory(dto: WpSyncHistoryDto): Promise<{ stored: number }> {
    const customer = await this.customers.findOne({
      where: { wpUserId: dto.wpUserId },
    });

    const rows = dto.records.map((payload) =>
      this.historicalRecords.create({
        wpUserId: dto.wpUserId,
        customerId: customer?.id ?? null,
        recordType: dto.recordType,
        payload,
        sourceVersion: dto.sourceVersion ?? null,
      }),
    );
    await this.historicalRecords.save(rows);
    return { stored: rows.length };
  }

  // Decision 5: reusable one-time historical-import scaffold. Runs now,
  // honestly empty - no WP export route exists yet to pull real history
  // from (see Open items in the migration plan). Swapping in a real
  // fetch via wpClient.request(...) later needs no redesign: this method
  // and the ImportRun row it produces are the permanent entry point.
  async runHistoricalImport(wpUserId?: string): Promise<ImportRun> {
    const run = this.importRuns.create({
      wpUserId: wpUserId ?? null,
      status: ImportRunStatus.RUNNING,
    });
    await this.importRuns.save(run);

    if (!this.wpClient.isConfigured()) {
      run.status = ImportRunStatus.EMPTY;
      run.notes =
        'WP_BASE_URL/WP_APP_USER/WP_APP_PASSWORD not configured yet - nothing to import. ' +
        'Run again once the WP-side export route and Application Password are wired up.';
      return this.importRuns.save(run);
    }

    // No history-bearing WP export route exists yet (none of the
    // migrated layers - Layer 1-3, Layer 69 - carry 2-month history).
    // Honest empty result, per the user's explicit "run it empty today"
    // decision, rather than fabricating a count.
    run.status = ImportRunStatus.EMPTY;
    run.recordsImported = 0;
    run.notes =
      'No history-bearing layer has migrated yet, so there is nothing real to import. ' +
      'This run is a no-op placeholder - re-run once a layer with real 2-month history ' +
      '(e.g. Blog Submission, Backlinks) has an Engine module and a WP export route.';
    return this.importRuns.save(run);
  }

  async listImportRuns(): Promise<ImportRun[]> {
    return this.importRuns.find({ order: { startedAt: 'DESC' } });
  }

  async findCustomerByWpUserId(wpUserId: string): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { wpUserId } });
    if (!customer) {
      throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    }
    return customer;
  }
}
