import { Ctx, MANGOOLS_FUNCTIONS, MangoolsFnDef, limitFor } from './functions';

export interface MangoolsResult {
  def: MangoolsFnDef;
  ok: boolean;
  data?: Record<string, any>;
  error?: string;
}

const hostOf = (website: string): string => website.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '');

// Runs every enabled Mangools function one after another (the API allows one request at a time).
// A function that fails does not stop the others. A plan CreditLimit stops the rest.
export async function runMangools(settings: Record<string, string>, website: string): Promise<MangoolsResult[]> {
  const domain = hostOf(website);
  const ctx: Ctx = { apiKey: settings.apiKey, domain, homepage: `https://${domain}/`, cache: {} };
  const out: MangoolsResult[] = [];
  let stop: string | null = null;
  for (const def of MANGOOLS_FUNCTIONS) {
    const limit = limitFor(def, settings[def.field]);
    if (limit === 0) continue;
    if (stop) {
      out.push({ def, ok: false, error: stop });
      continue;
    }
    try {
      out.push({ def, ok: true, data: await def.run(ctx, limit) });
    } catch (err: any) {
      const msg = String(err?.message ?? 'failed').slice(0, 240);
      out.push({ def, ok: false, error: `Mangools: ${msg}` });
      if (err?.kind === 'CreditLimit' || err?.kind === 'Auth') stop = `Mangools: ${msg}`;
    }
  }
  return out;
}
