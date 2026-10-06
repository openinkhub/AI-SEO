import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Customer, CustomerStatus } from '../customers/customer.entity';
import { ProjectsService } from '../projects/projects.service';
import { EmailService } from '../email/email.service';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { normalizeProfile } from '../customers/profile-normalize';

// Decided 2026-10-06: the Engine now owns the whole onboarding form, not
// just the data store behind it - WP no longer sends this email or hosts
// this page (see KP21_Customer_Signup v8.9.257). A bearer token, not a
// JWT/login, is deliberately how this is protected: the customer never
// gets an Engine account/password for this - the emailed link itself is
// the credential, same trust model as a password-reset link.
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(Customer) private customers: Repository<Customer>,
    private projects: ProjectsService,
    private email: EmailService,
  ) {}

  generateToken(): string {
    return randomBytes(24).toString('hex');
  }

  // Called from WpIntegrationService.upsertFromWp() right after a brand
  // new wp_sync customer is created. Best-effort and non-blocking by
  // design (mirrors WpClientService.notifyOnboardingReady) - a signup must
  // never fail or stall because the Engine's SMTP isn't configured yet.
  // Only stamps onboardingEmailSentAt on a confirmed send, so a failed/
  // unconfigured attempt is retried on the next wp-sync call rather than
  // silently marked as handled.
  async sendOnboardingEmailIfNeeded(customer: Customer): Promise<void> {
    if (customer.onboardingEmailSentAt) return; // already sent once
    if (!customer.contactEmail) {
      this.logger.warn(
        `Customer ${customer.id} has no contactEmail - cannot send onboarding email`,
      );
      return;
    }
    if (!customer.onboardingToken) {
      customer.onboardingToken = this.generateToken();
    }
    const base =
      process.env.ENGINE_PUBLIC_URL?.replace(/\/+$/, '') ||
      'https://app.openinkhub.cloud';
    const link = `${base}/onboarding.html?token=${customer.onboardingToken}`;
    const sent = await this.email.sendOnboardingEmail(
      customer.contactEmail,
      customer.companyName,
      link,
    );
    if (sent) customer.onboardingEmailSentAt = new Date();
    await this.customers.save(customer);
  }

  async findByToken(token: string): Promise<Customer> {
    const customer = await this.customers.findOne({
      where: { onboardingToken: token },
    });
    if (!customer) {
      throw new NotFoundException('Onboarding link not found or expired');
    }
    return customer;
  }

  // Merge, not replace - a key present in dto.profile overwrites, a key
  // simply absent (not part of whichever section/chunk posted this call)
  // is preserved. Required since 2026-10-07: the form now saves one field-
  // group at a time (Hostinger's edge CDN blocks any request body over 11
  // total JSON keys with a bare 403 "Forbidden", confirmed by direct
  // testing - purely a key-count limit, unrelated to content; ~75 fields
  // in one POST always hit it). Mirrors CustomersService.update()'s same
  // fix on the Admin dashboard side.
  //
  // Fixed 2026-10-07: status/onboardingCompletedAt used to be stamped on
  // every call, which was correct for a single one-shot submit but became
  // a bug once submission was split into one call per section - status
  // would have flipped to ACTIVE after the customer saved just the first
  // of ~7 sections. Completion is now its own explicit signal (`complete:
  // true`, sent with no profile payload by a dedicated "Submit profile"
  // control, separate from each section's own "Save this section"), so a
  // partial save never marks the profile done, and a group save and the
  // completion call can arrive as two separate requests in either order.
  async submitProfile(token: string, dto: SubmitOnboardingDto): Promise<Customer> {
    const customer = await this.findByToken(token);
    if (dto.profile) {
      const incoming = normalizeProfile(dto.profile);
      customer.profile = { ...(customer.profile ?? {}), ...incoming };
      const brandName = incoming['brand_name'];
      if (typeof brandName === 'string' && brandName.trim()) {
        customer.companyName = brandName.trim();
      }
      const domain = incoming['domain'];
      if (typeof domain === 'string' && domain.trim() && !customer.website) {
        customer.website = domain.trim();
      }
    }
    if (dto.complete) {
      customer.onboardingCompletedAt = new Date();
      if (customer.status === CustomerStatus.ONBOARDING) {
        customer.status = CustomerStatus.ACTIVE;
      }
    }
    const saved = await this.customers.save(customer);
    // "M0 & M1 should be present, with no data" applies here too - a
    // customer who completes onboarding straight from the emailed link
    // (never touched by Admin) still gets their Month shells. ensureMonths
    // is idempotent, so calling it on every section save (not just on
    // complete) is harmless and keeps this working even if the customer
    // never clicks the final "Submit profile" control.
    await this.projects.ensureMonths(saved.id);
    return saved;
  }
}
