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
import { OnboardingService } from '../onboarding/onboarding.service';

// Shape returned by the WP-side read-only export route (KP21_Engine_Export,
// plugin v8.9.258+): GET /wp-json/aiseo/v1/engine-export/customers.
interface WpExportedCustomer {
  wpUserId: string;
  email: string;
  displayName: string;
  registeredAt: string;
  // Optional - only sent by newer plugin builds; the Engine copes without.
  userLogin?: string;
  notificationEmail?: string;
  actDate?: string;
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
    private onboarding: OnboardingService,
  ) {}

  // Decision 1 ("auto fetch" sync): upsert, matched by wpUserId. A WP
  // user re-posted after an edit updates the same Engine row rather than
  // creating a duplicate customer.
  //
  // Updated 2026-10-06 ("automatic sync of new customer as customer
  // signup on wordpress, it syncs with backend engine and onboarding
  // form will be sent from engine" / "wp plugin will be only customer
  // view portal"): this is now the one place a brand-new signup's
  // onboarding email gets triggered - WP (KP21_Customer_Signup v8.9.257+)
  // no longer sends it or hosts the form itself, it just creates the WP
  // account and calls this endpoint.
  async upsertFromWp(dto: WpSyncCustomerDto): Promise<Customer> {
    let customer = await this.customers.findOne({
      where: { wpUserId: dto.wpUserId },
    });
    const isNew = !customer;

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
    // Layer 1 account basics for a brand-new signup: WP creates the account
    // moments before this call, so "now" (UTC, WP's own storage format) is
    // the registration time; a later "Sync WP Customer Profiles" overwrites
    // it with WP's exact user_registered.
    if (!customer.registeredAt) {
      customer.registeredAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    customer.accountEmail = customer.accountEmail ?? dto.contactEmail ?? null;
    customer.userName = customer.userName ?? dto.contactName ?? dto.companyName ?? null;

    const saved = await this.customers.save(customer);
    await this.projects.ensureMonths(saved.id);
    this.logger.log(
      `${isNew ? 'Created' : 'Synced'} customer from WP user ${dto.wpUserId} -> ${saved.id}`,
    );

    // Best-effort, never blocks/throws the signup if SMTP isn't
    // configured yet or WP is otherwise reachable but email isn't -
    // sendOnboardingEmailIfNeeded no-ops past the first successful send
    // (onboardingEmailSentAt), so re-syncing an existing customer is safe.
    await this.onboarding.sendOnboardingEmailIfNeeded(saved);

    // Best-effort: legacy WP-side acknowledgment route (never built, see
    // migration plan "Integration between WP and Engine" §4) - harmless
    // no-op kept for now rather than removed, in case WP still calls it.
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
  // read-only WP route (KP21_Engine_Export, plugin v8.9.258 - x-api-key auth) and merges
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

    if (!this.wpClient.isApiKeyConfigured()) {
      run.status = ImportRunStatus.EMPTY;
      run.notes = 'WP_BASE_URL/WP_ENGINE_API_KEY not configured - nothing to pull.';
      return this.importRuns.save(run);
    }

    // Authenticated with the shared x-api-key secret, not an Application
    // Password - see WpClientService.requestWithApiKey() for why (that
    // route's auth kept failing on this host even with a confirmed-good
    // Application Password; root cause was the host stripping the
    // Authorization header entirely, not the credential).
    const result = await this.wpClient.requestWithApiKey<WpExportResponse>(
      '/wp-json/aiseo/v1/engine-export/customers',
    );

    if (!result.ok || !result.data || !Array.isArray(result.data.customers)) {
      run.status = ImportRunStatus.FAILED;
      if (result.status === 401 || result.status === 403) {
        run.notes =
          `WP responded ${result.status} (auth rejected) for /wp-json/aiseo/v1/engine-export/customers: ` +
          `${result.error ?? 'no body'}. Confirm WP_ENGINE_API_KEY on Hostinger exactly matches the ` +
          `plugin's Engine API Key setting (wp-admin -> AI-SEO -> Settings -> Engine Sync), and that ` +
          `plugin v8.9.258+ is installed (earlier versions check a WP Application Password here instead).`;
      } else if (result.status) {
        run.notes =
          `WP responded ${result.status} for /wp-json/aiseo/v1/engine-export/customers: ` +
          `${result.error ?? 'no body'}. Confirm plugin v8.9.258+ is installed and active.`;
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
      // Layer 1 "ACT Account Registration" basics, straight from the WP account.
      customer.accountEmail = wp.email || customer.accountEmail || null;
      customer.userName = wp.userLogin || wp.displayName || customer.userName || null;
      if (wp.registeredAt) customer.registeredAt = String(wp.registeredAt).slice(0, 19);
      if (wp.actDate) customer.actDate = String(wp.actDate).slice(0, 19);
      if (wp.notificationEmail && !customer.notificationEmail) {
        customer.notificationEmail = wp.notificationEmail;
      }
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

  // Mirrors upsertFromWp() in the other direction - decided 2026-10-06
  // after a round of real test signups needed manual Engine-side cleanup
  // with no way to keep the two systems in sync automatically. WP's
  // delete_user hook calls this (DELETE /api/v1/wp-sync/customers/:wpUserId,
  // same x-api-key auth as every other wp-sync call) whenever a
  // keyword_planner_customer account is deleted in wp-admin. Idempotent
  // and silent on a miss - a WP user who never successfully synced (e.g.
  // the Engine-sync fallback case) has no Customer row to delete, and
  // that's not an error.
  async removeByWpUserId(wpUserId: string): Promise<{ deleted: boolean }> {
    const customer = await this.customers.findOne({ where: { wpUserId } });
    if (!customer) return { deleted: false };
    await this.projects.removeByCustomer(customer.id);
    await this.customers.remove(customer);
    this.logger.log(`Deleted customer ${customer.id} (WP user ${wpUserId}) - WP-side deletion`);
    return { deleted: true };
  }
}
