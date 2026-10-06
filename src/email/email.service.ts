import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Decided 2026-10-06: "automatic sync of new customer as customer signup
// on wordpress, it syncs with backend engine and onboarding form will be
// sent from engine" / "now onwards every action will take place from
// admin engine, wp plugin will be only customer view portal" - the Engine
// now owns sending the onboarding email itself (previously WP's
// KP21_Notifications::onboarding() did this), not just hosting a form WP
// links to. Plain SMTP via nodemailer rather than a third-party email API,
// since no such account/key exists yet and SMTP needs only env vars - same
// "gracefully unconfigured until real credentials exist" pattern as
// WpClientService: every call is safe to make whether or not SMTP_* is set.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    if (this.isConfigured()) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SMTP_HOST') &&
        this.config.get<string>('SMTP_USER') &&
        this.config.get<string>('SMTP_PASS'),
    );
  }

  private fromAddress(): string {
    return (
      this.config.get<string>('SMTP_FROM') ||
      this.config.get<string>('SMTP_USER') ||
      'no-reply@openinkhub.cloud'
    );
  }

  // Returns true only on a confirmed send - callers use this to decide
  // whether to stamp onboardingEmailSentAt, so an unconfigured/failed send
  // is retried on the next sync rather than silently marked as done.
  async sendOnboardingEmail(
    toEmail: string,
    companyName: string,
    onboardingUrl: string,
  ): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `Onboarding email to ${toEmail} skipped - SMTP_HOST/SMTP_USER/SMTP_PASS not configured`,
      );
      return false;
    }
    const subject = 'Welcome to Openink Hub - complete your business profile';
    const html = this.renderOnboardingHtml(companyName, onboardingUrl);
    try {
      await this.transporter.sendMail({
        from: this.fromAddress(),
        to: toEmail,
        subject,
        html,
        text: `Welcome to Openink Hub!\n\nComplete your business profile here:\n${onboardingUrl}\n\nThis link is unique to your account - no need to create a separate login.`,
      });
      this.logger.log(`Onboarding email sent to ${toEmail}`);
      return true;
    } catch (err) {
      this.logger.error(`Onboarding email to ${toEmail} failed: ${err}`);
      return false;
    }
  }

  private renderOnboardingHtml(companyName: string, onboardingUrl: string): string {
    const safeName = companyName
      ? companyName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : 'there';
    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr><td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="background:#111827;padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;">Openink Hub</span>
          </td></tr>
          <tr><td style="padding:32px;">
            <h1 style="font-size:20px;margin:0 0 16px;color:#111827;">Welcome, ${safeName}!</h1>
            <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 20px;">
              Your account is ready. The last step is telling us about your business so we
              can start your SEO work - takes about 5 minutes.
            </p>
            <p style="text-align:center;margin:0 0 24px;">
              <a href="${onboardingUrl}" style="display:inline-block;background:#111827;color:#ffffff;
                text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;">
                Complete your business profile
              </a>
            </p>
            <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0;">
              This link is unique to your account - no separate login needed. You can come back
              and update these details any time.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  }
}
