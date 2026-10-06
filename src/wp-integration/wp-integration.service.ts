import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, CustomerStatus } from '../customers/customer.entity';
import { ProjectsService } from '../projects/projects.service';
import { HistoricalRecord } from './historical-record.entity';
import { ImportRun, ImportRunStatus } from './import-run.entity';
import { WpSyncCustomerDto } from './dto/wp-sync-customer.dto';
import { WpSyncHistoryDto } from './dto/wp-sync-history.dto';
import { WpClientService } from './wp-client.service';

// Shape returned by the WP-side read-only export route (KP21_Engine_Export,
// plugin v8.9.256+): GET /wp-json/aiseo/v1/engine-export/customers.
interface WpExportedCustomer {
  wpUserId: string;
  email: string;
  displayName: string;
  registeredAt: string;
  onboardingStatus: string;
  profile: Record<string, unknown>;
}
interface WpExportResponse {
  customers: WpExportedCustomer[];
  count: number;
}

@Injectable()
export class WpIntegrationService {
  private readonly logger = new Logger(WpIntegrationService.name);

  constructor(
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(HistoricalRecord)
    private historicalRecords: Repository<HistoricalRecord>,
    @InjectRepository(ImportRun) private importRuns: Repository<ImportRun>,
    private wpClient: WpClientService,
    private projects: ProjectsService,
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

  // Decided 2026-10-06: "Pull and sync real customer Data and profile
  // rows, so that we have not to create again." Pulls every WP customer's
  // account basics + full onboarding-profile snapshot from the new
  // read-only WP route (KP21_Engine_Export, plugin v8.9.256) and merges
  // it into the matching Engine Customer row (matched/created by
  // wpUserId, same pairing as upsertFromWp), then ensures M0/M1 Month
  // shells exist for each — this is the real-data counterpart to the
  // dashboard/profile capability merged to `main` the same day. Safe to
  // re-run: an existing customer is updated in place rather than
  // duplicated; WP's profile values win for fields it sends (it's the
  // one source of truth for onboarding data), but any extra keys already
  // in Engine's profile that WP doesn't send are preserved, not dropped.
  async importWpCustomerProfiles(): Promise<ImportRun> {
    const run = this.importRuns.create({ status: ImportRunStatus.RUNNING });
    await this.importRuns.save(run);

    if (!this.wpClient.isConfigured()) {
      run.status = ImportRunStatus.EMPTY;
      run.notes =
        'WP_BASE_URL/WP_APP_USER/WP_APP_PASSWORD not configured - nothing to pull.';
      return this.importRuns.save(run);
    }

    const result = await this.wpClient.requestDetailed<WpExportResponse>(
      '/wp-json/aiseo/v1/engine-export/customers',
    );

    if (!result.ok || !result.data || !Array.isArray(result.data.customers)) {
      run.status = ImportRunStatus.FAILED;
      if (result.status === 401 || result.status === 403) {
        run.notes =
          `WP responded ${result.status} (auth rejected) for /wp-json/aiseo/v1/engine-export/customers: ` +
          `${result.error ?? 'no body'}. Check that WP_APP_USER/WP_APP_PASSWORD on Hostinger match a ` +
          `current, un-revoked Application Password for an Administrator account. If the credential is ` +
          `confirmed correct and this still fails, the host may be stripping the Authorization header ` +
          `before WordPress sees it - a known issue on some shared hosting that needs an .htaccess fix.`;
      } else if (result.status) {
        run.notes =
          `WP responded ${result.status} for /wp-json/aiseo/v1/engine-export/customers: ` +
          `${result.error ?? 'no body'}. Confirm plugin v8.9.256+ is installed and active.`;
      } else {
        run.notes =
          `Could not reach WP at all (no HTTP response) - ${result.error ?? 'unknown network error'}. ` +
          `Check WP_BASE_URL on Hostinger points at the live site (e.g. https://openinkhub.cloud, no trailing slash).`;
      }
      return this.importRuns.save(run);
    }

    const data = result.data;
    let created = 0;
    let updated = 0;

    for (const wp of data.customers) {
      let customer = await this.customers.findOne({
        where: { wpUserId: wp.wpUserId },
      });
      const isNew = !customer;
      if (!customer) {
        customer = this.customers.create({
          wpUserId: wp.wpUserId,
          source: 'wp_sync',
          status: CustomerStatus.ONBOARDING,
          companyName: wp.displayName || wp.email,
        });
      }

      const profile = (wp.profile ?? {}) as Record<
        string,
        string | string[] | boolean
      >;
      customer.profile = { ...(customer.profile ?? {}), ...profile };
      customer.companyName =
        (profile.brand_name as string) ||
        customer.companyName ||
        wp.displayName ||
        wp.email;
      customer.contactEmail =
        customer.contactEmail ?? (profile.public_email as string) ?? wp.email;
      customer.website = customer.website ?? (profile.domain as string) ?? null;
      customer.industry =
        customer.industry ?? (profile.industry as string) ?? null;
      if (!customer.competitors && Array.isArray(profile.competitors)) {
        customer.competitors = profile.competitors as string[];
      }

      const saved = await this.customers.save(customer);
      if (isNew) created++;
      else updated++;

      // "M0 & M1 should be present, with no data" (2026-10-06 cutover
      // decision) — every imported WP customer gets this guaranteed too.
      await this.projects.ensureMonths(saved.id);
    }

    run.status = ImportRunStatus.COMPLETED;
    run.recordsImported = data.customers.length;
    run.notes =
      `Imported ${data.customers.length} WP customer profile(s): ${created} created, ` +
      `${updated} updated. Month shells (M0/M1) ensured for each.`;
    this.logger.log(run.notes);
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
