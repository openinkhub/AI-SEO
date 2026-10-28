import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerApiSetting } from './customer-api-setting.entity';
import { Customer } from '../customers/customer.entity';
import { API_PROVIDERS, ApiProvider, findProvider, isComplete } from './api-catalog';
import { decryptJson, encryptJson } from './key-crypto';
import { SaveApiSettingDto } from './customer-apis.dto';

type Values = Record<string, string>;

@Injectable()
export class CustomerApisService {
  constructor(
    @InjectRepository(CustomerApiSetting) private readonly repo: Repository<CustomerApiSetting>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  private provider(key: string): ApiProvider {
    const p = findProvider(key);
    if (!p) throw new NotFoundException(`Unknown API provider "${key}".`);
    return p;
  }

  private async ensureCustomer(customerId: string): Promise<Customer> {
    const c = await this.customers.findOne({ where: { id: customerId } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  // Never returns a secret: non-secret fields come back as-is, secrets as {isSet, hint: last 4}.
  private present(p: ApiProvider, row: CustomerApiSetting | undefined) {
    const vals = row ? decryptJson<Values>(row.valuesEnc) ?? {} : {};
    const hints: Record<string, string> = row?.hints ? JSON.parse(row.hints) : {};
    const fields = p.fields.map((f) => ({
      name: f.name,
      label: f.label,
      secret: f.secret,
      multiline: !!f.multiline,
      number: !!f.number,
      optional: !!f.optional,
      placeholder: f.placeholder,
      isSet: !!vals[f.name],
      value: f.secret ? undefined : vals[f.name] ?? '',
      hint: f.secret && vals[f.name] ? hints[f.name] ?? '' : undefined,
    }));
    const complete = isComplete(p, vals);
    return {
      provider: p.key,
      label: p.label,
      group: p.group,
      description: p.description,
      usedBy: p.usedBy,
      wired: p.wired,
      testable: p.testable,
      fields,
      anyOf: !!p.anyOf,
      configured: !!row && complete,
      enabled: row ? row.enabled : false,
      lastStatus: row?.lastStatus ?? null,
      lastMessage: row?.lastMessage ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
    };
  }

  async view(customerId: string) {
    await this.ensureCustomer(customerId);
    const rows = await this.repo.find({ where: { customerId } });
    return API_PROVIDERS.map((p) => this.present(p, rows.find((r) => r.provider === p.key)));
  }

  async save(customerId: string, providerKey: string, dto: SaveApiSettingDto) {
    await this.ensureCustomer(customerId);
    const p = this.provider(providerKey);
    const existing = await this.repo.findOne({ where: { customerId, provider: p.key } });
    const current: Values = existing ? decryptJson<Values>(existing.valuesEnc) ?? {} : {};
    const next: Values = { ...current };
    const given = dto.values ?? {};
    for (const f of p.fields) {
      const v = typeof given[f.name] === 'string' ? given[f.name].trim() : undefined;
      if (v === undefined) continue;
      if (f.secret && v === '') continue; // blank secret = keep the stored one
      if (v.length > 12000) throw new BadRequestException(`${f.label} is too long.`);
      next[f.name] = v;
    }
    if (next.ga4Property && !/^\d+$/.test(next.ga4Property.replace(/^properties\//, ''))) {
      throw new BadRequestException('GA4 property ID must be numbers only.');
    }
    for (const f of p.fields) {
      if (f.number && next[f.name] && !/^\d+$/.test(next[f.name])) throw new BadRequestException(`${f.label} must be a number.`);
    }
    const hints: Record<string, string> = {};
    for (const f of p.fields) if (f.secret && next[f.name]) hints[f.name] = next[f.name].slice(-4);

    const row = existing ?? this.repo.create({ customerId, provider: p.key });
    row.valuesEnc = encryptJson(next);
    row.hints = JSON.stringify(hints);
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    else if (!existing) row.enabled = true;
    row.lastStatus = null; // changed - needs a fresh test
    row.lastMessage = null;
    row.lastCheckedAt = null;
    await this.repo.save(row);
    return this.present(p, row);
  }

  async remove(customerId: string, providerKey: string) {
    const p = this.provider(providerKey);
    await this.repo.delete({ customerId, provider: p.key });
    return { deleted: true };
  }

  async test(customerId: string, providerKey: string) {
    const p = this.provider(providerKey);
    const row = await this.repo.findOne({ where: { customerId, provider: p.key } });
    const vals = row ? decryptJson<Values>(row.valuesEnc) : null;
    if (!row || !vals) throw new BadRequestException('Save the settings first.');
    let ok = true;
    let msg = 'Saved. A live test is not available for this API yet.';
    if (p.testable) {
      try {
        msg = await this.liveTest(p.key, vals);
      } catch (err) {
        ok = false;
        msg = (err instanceof Error ? err.message : 'Test failed').slice(0, 250);
      }
    }
    row.lastStatus = p.testable ? (ok ? 'ok' : 'failed') : null;
    row.lastMessage = msg;
    row.lastCheckedAt = new Date();
    await this.repo.save(row);
    return this.present(p, row);
  }

  private async liveTest(key: string, v: Values): Promise<string> {
    const sig = AbortSignal.timeout(20000);
    if (key === 'pagespeed') {
      const q = new URLSearchParams({ url: 'https://example.com', key: v.apiKey, category: 'seo', strategy: 'mobile' });
      const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(45000) });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b?.error?.message || `HTTP ${res.status}`);
      return 'Key works - PageSpeed responded.';
    }
    if (key === 'mangools') {
      const res = await fetch('https://api.mangools.com/v3/kwfinder/limits', { headers: { 'x-access-token': v.apiKey, Accept: 'application/json' }, signal: sig });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b?.error?.message || `HTTP ${res.status}`);
      return 'Key works - Mangools responded.';
    }
    if (key === 'serpapi') {
      const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(v.apiKey)}`, { signal: sig });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok || b.error) throw new Error(b.error || `HTTP ${res.status}`);
      return `Key works - ${b.total_searches_left ?? b.plan_searches_left ?? '?'} searches left.`;
    }
    if (key === 'keywords_everywhere') {
      const res = await fetch('https://api.keywordseverywhere.com/v1/credits', { headers: { Authorization: `Bearer ${v.apiKey}`, Accept: 'application/json' }, signal: sig });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b?.message || `HTTP ${res.status}`);
      return `Key works - ${b?.credits ?? '?'} credits left.`;
    }
    return 'No test for this API.';
  }

  // All customers x all APIs, for the admin overview table.
  async overview() {
    const [customers, rows] = await Promise.all([
      this.customers.find({ order: { companyName: 'ASC' } }),
      this.repo.find(),
    ]);
    return {
      providers: API_PROVIDERS.map((p) => ({ key: p.key, label: p.label, group: p.group, wired: p.wired })),
      customers: customers.map((c) => ({
        id: c.id,
        companyName: c.companyName,
        website: c.website,
        apis: Object.fromEntries(
          API_PROVIDERS.map((p) => {
            const r = rows.find((x) => x.customerId === c.id && x.provider === p.key);
            const vals = r ? decryptJson<Values>(r.valuesEnc) : null;
            const complete = isComplete(p, vals);
            const status = !r || !complete ? 'missing' : !r.enabled ? 'off' : r.lastStatus === 'failed' ? 'failed' : r.lastStatus === 'ok' ? 'ok' : 'set';
            return [p.key, status];
          }),
        ),
      })),
    };
  }

  // Internal: decrypted values for every enabled, complete API of a customer.
  async getKeys(customerId: string): Promise<Record<string, Values>> {
    const rows = await this.repo.find({ where: { customerId, enabled: true } });
    const out: Record<string, Values> = {};
    for (const r of rows) {
      const p = findProvider(r.provider);
      const v = decryptJson<Values>(r.valuesEnc);
      if (p && v && isComplete(p, v)) out[r.provider] = v;
    }
    return out;
  }
}
