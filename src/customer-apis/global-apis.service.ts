import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GlobalApiSetting } from './global-api-setting.entity';
import { GLOBAL_API_PROVIDERS, ApiProvider, findGlobalProvider, isComplete } from './api-catalog';
import { decryptJson, encryptJson } from './key-crypto';
import { SaveApiSettingDto } from './customer-apis.dto';
import { mozUrlMetrics } from './moz';
import { askPlatform, GLOBAL_AI_KEYS } from '../layers/ai-platforms';

type Values = Record<string, string>;

@Injectable()
export class GlobalApisService {
  constructor(@InjectRepository(GlobalApiSetting) private readonly repo: Repository<GlobalApiSetting>) {}

  private provider(key: string): ApiProvider {
    const p = findGlobalProvider(key);
    if (!p) throw new NotFoundException(`Unknown global API "${key}".`);
    return p;
  }

  private present(p: ApiProvider, row: GlobalApiSetting | undefined) {
    const vals = row ? decryptJson<Values>(row.valuesEnc) ?? {} : {};
    const hints: Record<string, string> = row?.hints ? JSON.parse(row.hints) : {};
    return {
      provider: p.key,
      label: p.label,
      group: p.group,
      description: p.description,
      usedBy: p.usedBy,
      wired: p.wired,
      testable: p.testable,
      fields: p.fields.map((f) => ({
        name: f.name,
        label: f.label,
        secret: f.secret,
        number: !!f.number,
        optional: !!f.optional,
        isSet: !!vals[f.name],
        value: f.secret ? undefined : vals[f.name] ?? '',
        hint: f.secret && vals[f.name] ? hints[f.name] ?? '' : undefined,
      })),
      configured: !!row && isComplete(p, vals),
      enabled: row ? row.enabled : false,
      lastStatus: row?.lastStatus ?? null,
      lastMessage: row?.lastMessage ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
    };
  }

  async view() {
    const rows = await this.repo.find();
    return GLOBAL_API_PROVIDERS.map((p) => this.present(p, rows.find((r) => r.provider === p.key)));
  }

  async save(providerKey: string, dto: SaveApiSettingDto) {
    const p = this.provider(providerKey);
    const existing = await this.repo.findOne({ where: { provider: p.key } });
    const next: Values = { ...(existing ? decryptJson<Values>(existing.valuesEnc) ?? {} : {}) };
    for (const f of p.fields) {
      const v = typeof dto.values?.[f.name] === 'string' ? dto.values[f.name].trim() : undefined;
      if (v === undefined) continue;
      if (f.secret && v === '') continue; // blank secret = keep the stored one
      if (v.length > 2000) throw new BadRequestException(`${f.label} is too long.`);
      if (f.number && v && !/^\d+$/.test(v)) throw new BadRequestException(`${f.label} must be a number.`);
      next[f.name] = v;
    }
    const hints: Record<string, string> = {};
    for (const f of p.fields) if (f.secret && next[f.name]) hints[f.name] = next[f.name].slice(-4);
    const row = existing ?? this.repo.create({ provider: p.key });
    row.valuesEnc = encryptJson(next);
    row.hints = JSON.stringify(hints);
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    else if (!existing) row.enabled = true;
    row.lastStatus = null;
    row.lastMessage = null;
    row.lastCheckedAt = null;
    await this.repo.save(row);
    return this.present(p, row);
  }

  async test(providerKey: string) {
    const p = this.provider(providerKey);
    const row = await this.repo.findOne({ where: { provider: p.key } });
    const vals = row ? decryptJson<Values>(row.valuesEnc) : null;
    if (!row || !vals) throw new BadRequestException('Save the settings first.');
    let ok = true;
    let msg = 'Saved. A live test is not available for this API yet.';
    if (p.key === 'moz') {
      try {
        const r = await mozUrlMetrics({ apiToken: vals.apiToken, accessId: vals.accessId, secretKey: vals.secretKey }, ['moz.com']);
        msg = r[0]?.domainAuthority != null ? `Keys work - Moz responded (moz.com DA ${r[0].domainAuthority}).` : 'Moz responded but returned no Domain Authority.';
      } catch (err) {
        ok = false;
        msg = (err instanceof Error ? err.message : 'Test failed').slice(0, 250);
      }
    }
    if (p.key === 'google_ai') {
      try {
        const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(vals.apiKey)}`, { signal: AbortSignal.timeout(20000) });
        const b: any = await res.json().catch(() => ({}));
        if (!res.ok || b.error) throw new Error(String(b.error || `HTTP ${res.status}`));
        msg = `Key works - SerpApi responded (${b.total_searches_left ?? b.plan_searches_left ?? '?'} searches left).`;
      } catch (err) {
        ok = false;
        msg = (err instanceof Error ? err.message : 'Test failed').slice(0, 250);
      }
    }
    if (GLOBAL_AI_KEYS.includes(p.key)) {
      try {
        const reply = await askPlatform(p.key, vals, 'Reply with the single word OK.');
        msg = reply.trim() ? `Key works - ${p.label} replied.` : `${p.label} answered with an empty reply.`;
        ok = !!reply.trim();
      } catch (err) {
        ok = false;
        msg = (err instanceof Error ? err.message : 'Test failed').slice(0, 250);
      }
    }
    row.lastStatus = ok ? 'ok' : 'failed';
    row.lastMessage = msg;
    row.lastCheckedAt = new Date();
    await this.repo.save(row);
    return this.present(p, row);
  }

  async remove(providerKey: string) {
    const p = this.provider(providerKey);
    await this.repo.delete({ provider: p.key });
    return { deleted: true };
  }

  // Enabled + complete global keys, decrypted, for the audit runner.
  async getKeys(): Promise<Record<string, Values>> {
    const rows = await this.repo.find();
    const out: Record<string, Values> = {};
    for (const r of rows) {
      const p = findGlobalProvider(r.provider);
      const v = decryptJson<Values>(r.valuesEnc);
      if (p && r.enabled && v && isComplete(p, v)) out[p.key] = v;
    }
    return out;
  }
}
