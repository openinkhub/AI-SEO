import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Customer, CustomerStatus } from '../customers/customer.entity';
import { ProjectsService } from '../projects/projects.service';
import { EmailService } from '../email/email.service';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';

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

  // Deliberately a full-replace merge, not per-field - matches how WP's
  // own onboarding form and the Admin dashboard's profile editor both
  // persist (see wp-integration.service.ts's importWpCustomerProfiles
  // comment for why "last writer wins" is acceptable here: there is only
  // ever one legitimate writer - the customer themself - for this form).
  async submitProfile(token: string, dto: SubmitOnboardingDto): Promise<Customer> {
    const customer = await this.findByToken(token);
    customer.profile = { ...(customer.profile ?? {}), ...dto.profile };
    const brandName = dto.profile['brand_name'];
    if (typeof brandName === 'string' && brandName.trim()) {
      customer.companyName = brandName.trim();
    }
    const domain = dto.profile['domain'];
    if (typeof domain === 'string' && domain.trim() && !customer.website) {
      customer.website = domain.trim();
    }
    customer.onboardingCompletedAt = new Date();
    if (customer.status === CustomerStatus.ONBOARDING) {
      customer.status = CustomerStatus.ACTIVE;
    }
    const saved = await this.customers.save(customer);
    // "M0 & M1 should be present, with no data" applies here too - a
    // customer who completes onboarding straight from the emailed link
    // (never touched by Admin) still gets their Month shells.
    await this.projects.ensureMonths(saved.id);
    return saved;
  }
}
