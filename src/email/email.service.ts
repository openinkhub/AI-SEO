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
//
// Encryption + reply-to/cc decided 2026-10-06 (verbatim): "For SMTP you
// have not taken encryption value, add reply path to info@openinkhub.io
// and cc to info@openinkhub.cloud. All notification mail will be send as
// same rule." - SMTP_ENCRYPTION ('ssl' | 'tls'/'starttls' | 'none') picks
// the transport mode explicitly instead of inferring it only from
// SMTP_SECURE, falling back to a sane default from the port if unset.
// Every outbound email goes through deliver() below, so Reply-To
// (SMTP_REPLY_TO, default info@openinkhub.io) and Cc
// (SMTP_NOTIFICATION_CC, default info@openinkhub.cloud) apply uniformly to
// every current and future notification email without each new send
// method having to remember the rule itself.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    if (this.isConfigured()) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const encryption = this.resolveEncryption(port);
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port,
        secure: encryption === 'ssl',
        requireTLS: encryption === 'tls',
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
      this.logger.log(
        `SMTP transporter configured (host ${this.config.get<string>('SMTP_HOST')}, port ${port}, encryption: ${encryption})`,
      );
    }
  }

  // 'ssl' = implicit TLS from the first byte of the connection (typically
  // port 465). 'tls' = plaintext connect then STARTTLS upgrade (typically
  // port 587 or 25) - also accepts the legacy spelling 'starttls'. 'none' =
  // unencrypted, only for a local/trusted relay, never recommended for a
  // real mailbox. Falls back to SMTP_SECURE ('true' => 'ssl') for anyone
  // who set that before SMTP_ENCRYPTION existed, then to a port-based
  // default so an unset value still does something sensible.
  private resolveEncryption(port: number): 'ssl' | 'tls' | 'none' {
    const raw = (this.config.get<string>('SMTP_ENCRYPTION') || '')
      .toLowerCase()
      .trim();
    if (raw === 'ssl' || raw === 'tls' || raw === 'none') return raw;
    if (raw === 'starttls') return 'tls';
    if (this.config.get<string>('SMTP_SECURE') === 'true') return 'ssl';
    if (port === 465) return 'ssl';
    if (port === 587 || port === 25) return 'tls';
    return 'none';
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

  private replyToAddress(): string {
    return this.config.get<string>('SMTP_REPLY_TO') || 'info@openinkhub.io';
  }

  private notificationCc(): string | undefined {
    return (
      this.config.get<string>('SMTP_NOTIFICATION_CC') ||
      'info@openinkhub.cloud'
    );
  }

  // Every outbound notification email goes through here, so Reply-To and
  // Cc (decided 2026-10-06, see class comment above) apply uniformly - a
  // future notification method just builds subject/html/text and calls
  // this, it never needs to remember the reply-to/cc rule on its own.
  // Returns true only on a confirmed send.
  private async deliver(opts: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `Email to ${opts.to} ("${opts.subject}") skipped - SMTP_HOST/SMTP_USER/SMTP_PASS not configured`,
      );
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddress(),
        to: opts.to,
        cc: this.notificationCc(),
        replyTo: this.replyToAddress(),
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      this.logger.log(`Email sent to ${opts.to} ("${opts.subject}")`);
      return true;
    } catch (err) {
      this.logger.error(`Email to ${opts.to} ("${opts.subject}") failed: ${err}`);
      return false;
    }
  }

  // Returns true only on a confirmed send - callers use this to decide
  // whether to stamp onboardingEmailSentAt, so an unconfigured/failed send
  // is retried on the next sync rather than silently marked as done.
  async sendOnboardingEmail(
    toEmail: string,
    companyName: string,
    onboardingUrl: string,
    resend = false,
    account: { username?: string | null; loginUrl?: string | null } = {},
  ): Promise<boolean> {
    const loginText = account.username
      ? `\n\nYour username: ${account.username}\nYou can also sign in with your email address.${account.loginUrl ? '\nLog in: ' + account.loginUrl : ''}`
      : '';
    const GOOGLE_TEXT = '\n\nGoogle access: in the "Google & Analytics IDs" section, give access to both addresses (Manager or Admin where available, otherwise add as a user):\n1. openink.in@gmail.com - Search Console, GA4, Tag Manager, Google Ads, Merchant Center, Ad Manager, Business Profile, YouTube\n2. keyword-planner@openink-hub-1785436666839.iam.gserviceaccount.com - Search Console (Restricted user) and GA4 (Viewer)';
    // resend = an admin sending the link again so the customer can finish or
    // update the profile. The form opens pre-filled with what is already saved.
    return this.deliver({
      to: toEmail,
      subject: resend
        ? 'Openink Hub - review and update your business profile'
        : 'Welcome to Openink Hub - complete your business profile',
      html: this.renderOnboardingHtml(companyName, onboardingUrl, resend, account),
      text: resend
        ? `Hello!\n\nPlease review and complete your business profile here:\n${onboardingUrl}\n\nThe details we already have are filled in. Update anything and save - no field is mandatory.${GOOGLE_TEXT}\n\nThis link is unique to your account - no need to create a separate login.${loginText}`
        : `Welcome to Openink Hub!\n\nComplete your business profile here:\n${onboardingUrl}${GOOGLE_TEXT}\n\nThis link is unique to your account - no need to create a separate login.${loginText}`,
    });
  }

  // "Your SEO report is ready" - sent once per audit run after the report (incl. research) is generated.
  async sendReportReadyEmail(
    toEmail: string,
    companyName: string,
    website: string,
    portalUrl: string | null = null,
  ): Promise<boolean> {
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const name = companyName || 'there';
    const site = website ? ` for ${website}` : '';
    const button = portalUrl
      ? `<p style="text-align:center;margin:0 0 24px;"><a href="${esc(portalUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;">Open your SEO report</a></p>`
      : '';
    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr><td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="background:#111827;padding:24px 32px;"><span style="color:#ffffff;font-size:20px;font-weight:bold;">Openink Hub</span></td></tr>
          <tr><td style="padding:32px;">
            <h1 style="font-size:20px;margin:0 0 16px;color:#111827;">Your SEO report is ready</h1>
            <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 20px;">Hello ${esc(name)}, your SEO report${esc(site)} has been generated. It lists every page of your website with its H1 keyword, meta title and meta description, followed by the audit findings and our suggestions.</p>
            ${button}
            <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0;">Sign in to your Openink Hub account to view the full report.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
    const text = `Hello ${name},\n\nYour SEO report${site} has been generated. It lists every page of your website with its H1 keyword, meta title and meta description, followed by the audit findings and our suggestions.\n${portalUrl ? `\nOpen your report: ${portalUrl}\n` : '\nSign in to your Openink Hub account to view the full report.\n'}`;
    return this.deliver({ to: toEmail, subject: `Your SEO report is ready${companyName ? ' - ' + companyName : ''}`, html, text });
  }

  private renderOnboardingHtml(
    companyName: string,
    onboardingUrl: string,
    resend = false,
    account: { username?: string | null; loginUrl?: string | null } = {},
  ): string {
    const safeName = companyName
      ? companyName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : 'there';
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const loginHtml = account.username
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:#f3f4f6;border-radius:6px;padding:14px 16px;font-size:14px;color:#374151;">` +
        `Your username: <b style="font-size:16px;color:#111827;">${esc(account.username)}</b><br>` +
        `You can also sign in with your email address.` +
        (account.loginUrl ? ` <a href="${esc(account.loginUrl)}" style="color:#2563eb;">Log in</a>` : '') +
        `</td></tr></table>`
      : '';
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
            <h1 style="font-size:20px;margin:0 0 16px;color:#111827;">${resend ? 'Hello' : 'Welcome'}, ${safeName}!</h1>
            <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 20px;">
              ${
                resend
                  ? 'Please review and complete your business profile. The details we already have are filled in - update anything and save. No field is mandatory.'
                  : 'Your account is ready. The last step is telling us about your business so we can start your SEO work - takes about 5 minutes.'
              }
            </p>
            <p style="text-align:center;margin:0 0 24px;">
              <a href="${onboardingUrl}" style="display:inline-block;background:#111827;color:#ffffff;
                text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;">
                Complete your business profile
              </a>
            </p>
            ${loginHtml}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:#eff6ff;border-radius:6px;padding:14px 16px;font-size:13px;line-height:1.6;color:#1e3a8a;">
              <b>Google access.</b> In the "Google &amp; Analytics IDs" section, give access to both addresses (Manager or Admin where available, otherwise add as a user):<br>
              1. <b>openink.in@gmail.com</b> - Search Console, GA4, Tag Manager, Google Ads, Merchant Center, Ad Manager, Business Profile, YouTube<br>
              2. <b>keyword-planner@openink-hub-1785436666839.iam.gserviceaccount.com</b> - Search Console (Restricted user) and GA4 (Viewer)
            </td></tr></table>
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
