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

  // Gate for requestWithApiKey() below - deliberately independent of
  // WP_APP_USER/WP_APP_PASSWORD, since that credential is no longer part
  // of this auth path.
  isApiKeyConfigured(): boolean {
    return Boolean(this.baseUrl && this.config.get<string>('WP_ENGINE_API_KEY'));
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

  // Decided 2026-10-06, added after "Sync WP Customer Profiles" failed
  // twice in a row with the same generic message even after the user
  // regenerated the WP Application Password: request() swallows the
  // actual HTTP status/response body, so there was no way to tell a bad
  // credential apart from a host that strips the Authorization header
  // (a known shared-hosting gotcha with WP Application Passwords) apart
  // from a plain network/DNS failure. This variant returns that detail
  // instead of null, so the caller can report something a person can
  // actually act on.
  async requestDetailed<T = unknown>(
    path: string,
    opts: WpRestOptions = {},
  ): Promise<{
    ok: boolean;
    status: number | null;
    data: T | null;
    error: string | null;
  }> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        status: null,
        data: null,
        error: 'WP_BASE_URL/WP_APP_USER/WP_APP_PASSWORD not configured',
      };
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
      const text = await res.text();
      let data: T | null = null;
      try {
        data = text ? (JSON.parse(text) as T) : null;
      } catch {
        // Non-JSON body (an HTML error page from the host, a WAF block
        // page, etc.) - leave data null, the raw text still goes in error.
      }
      if (!res.ok) {
        this.logger.error(
          `WP REST ${opts.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
        );
        return {
          ok: false,
          status: res.status,
          data,
          error: text.slice(0, 300) || `HTTP ${res.status}`,
        };
      }
      return { ok: true, status: res.status, data, error: null };
    } catch (err) {
      this.logger.error(`WP REST ${opts.method ?? 'GET'} ${path} failed: ${err}`);
      return { ok: false, status: null, data: null, error: String(err) };
    }
  }

  // Added 2026-10-06 for KP21_Engine_Export (/wp-json/aiseo/v1/engine-export/
  // customers) after that route kept failing with the same generic
  // auth-rejected error even once the user confirmed/regenerated the WP
  // Application Password - root-caused to Hostinger silently stripping the
  // Authorization header before PHP/WordPress ever sees it on this host (a
  // known shared-hosting gotcha with Basic Auth, unrelated to whether the
  // credential itself is correct). x-api-key is a plain custom header, not
  // Authorization, so it isn't subject to that stripping - proven by the
  // WP -> Engine direction, which already authenticates every wp-sync call
  // this same way successfully. Reuses the same WP_ENGINE_API_KEY secret
  // already shared between WP and Engine, rather than introducing a second
  // credential to keep in sync.
  async requestWithApiKey<T = unknown>(
    path: string,
  ): Promise<{
    ok: boolean;
    status: number | null;
    data: T | null;
    error: string | null;
  }> {
    const base = this.baseUrl;
    const key = this.config.get<string>('WP_ENGINE_API_KEY');
    if (!base || !key) {
      return {
        ok: false,
        status: null,
        data: null,
        error: 'WP_BASE_URL/WP_ENGINE_API_KEY not configured',
      };
    }
    const url = `${base.replace(/\/+$/, '')}${path}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      });
      const text = await res.text();
      let data: T | null = null;
      try {
        data = text ? (JSON.parse(text) as T) : null;
      } catch {
        // Non-JSON body (an HTML error page, a WAF block page, etc.) -
        // leave data null, the raw text still goes in error.
      }
      if (!res.ok) {
        this.logger.error(
          `WP REST GET ${path} -> ${res.status}: ${text.slice(0, 300)}`,
        );
        return {
          ok: false,
          status: res.status,
          data,
          error: text.slice(0, 300) || `HTTP ${res.status}`,
        };
      }
      return { ok: true, status: res.status, data, error: null };
    } catch (err) {
      this.logger.error(`WP REST GET ${path} failed: ${err}`);
      return { ok: false, status: null, data: null, error: String(err) };
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
