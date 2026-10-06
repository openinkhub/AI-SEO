import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WpRestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

// Engine -> WP calls, authenticated with a WordPress Application Password
// (built into WP core, no extra plugin needed) over Basic auth, per the
// "Integration between WP and Engine" contract, item 2.
@Injectable()
export class WpClientService {
  private readonly logger = new Logger(WpClientService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string | undefined {
    return this.config.get<string>('WP_BASE_URL');
  }

  private authHeader(): string | null {
    const user = this.config.get<string>('WP_APP_USER');
    const pass = this.config.get<string>('WP_APP_PASSWORD');
    if (!user || !pass) return null;
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.authHeader());
  }

  // Generic helper for any future WP REST route (custom KP21 routes or
  // WP core routes). Returns null (and logs) instead of throwing, so a
  // WP-side outage never crashes an Engine request that merely wants to
  // notify WP.
  async request<T = unknown>(
    path: string,
    opts: WpRestOptions = {},
  ): Promise<T | null> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `WP REST call to ${path} skipped - WP_BASE_URL/WP_APP_USER/WP_APP_PASSWORD not set`,
      );
      return null;
    }
    const url = `${this.baseUrl!.replace(/\/+$/, '')}${path}`;
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: this.authHeader()!,
          'Content-Type': 'application/json',
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        this.logger.error(`WP REST ${opts.method ?? 'GET'} ${path} -> ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.error(`WP REST ${opts.method ?? 'GET'} ${path} failed: ${err}`);
      return null;
    }
  }

  // Notifies the WP-side signup/sync route (once built in KP21) that the
  // Engine has finished creating/updating this customer, so WP can send
  // the onboarding form link. Honest no-op (returns false) until that WP
  // route exists - never throws.
  async notifyOnboardingReady(wpUserId: string): Promise<boolean> {
    const result = await this.request('/wp-json/kp21/v1/engine-sync-ack', {
      method: 'POST',
      body: { wpUserId, status: 'synced' },
    });
    return result !== null;
  }
}
