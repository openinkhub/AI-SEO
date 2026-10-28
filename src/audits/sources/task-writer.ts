import { Logger } from '@nestjs/common';

const logger = new Logger('TaskWriter');

export interface TaskToWrite {
  id: string;
  skill: string;
  finds: string;
  actionOutput: string;
}
export interface WrittenTask {
  finding: string;
  suggestion: string | null;
}

// One model call per research source: it reads the collected data and writes a finding + suggestion for each
// of the 140-task rows that source feeds. Anything the data does not cover is said so, never invented.
export async function writeTasks(sourceLabel: string, data: unknown, tasks: TaskToWrite[], site: string, opts: { maxChars?: number; planning?: boolean } = {}): Promise<Map<string, WrittenTask>> {
  const out = new Map<string, WrittenTask>();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const dataText = JSON.stringify(data).slice(0, opts.maxChars ?? 9000);
  const planning = opts.planning
    ? '\nThese are planning / drafting tasks. Do NOT write the deliverable itself (no full articles). State what the audit evidence says about this area, then give a concrete recommended brief or next step.'
    : '';
  for (let i = 0; i < tasks.length; i += 10) {
    const batch = tasks.slice(i, i + 10);
    const prompt = `You are an SEO analyst at Openink Hub. For the website ${site}, write the result of each audit task below using ONLY the research data provided (source: ${sourceLabel}). Plain, client-friendly English. Quote real numbers, keywords and names from the data. If the data does not cover what a task asks, say in one short sentence what is missing instead of guessing. Never promise rankings or traffic.${planning}

RESEARCH DATA
${dataText}

TASKS
${batch.map((t) => `- id ${t.id} | ${t.skill} | looks at: ${t.finds} | should produce: ${t.actionOutput}`).join('\n')}

Reply with ONLY JSON: {"tasks":[{"id":"...","finding":"1-3 sentences","suggestion":"1-2 sentences or null"}]}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 3500, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(90000),
    });
    const body = (await res.json().catch(() => ({}))) as { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      logger.warn(`Task writer failed: ${msg}`);
      throw new Error(`Task writer failed: ${msg}`);
    }
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a < 0 || b <= a) continue;
    try {
      const obj = JSON.parse(text.slice(a, b + 1));
      for (const r of Array.isArray(obj.tasks) ? obj.tasks : []) {
        if (r && typeof r.id === 'string' && typeof r.finding === 'string' && r.finding.trim()) {
          out.set(r.id, { finding: r.finding.trim().slice(0, 900), suggestion: typeof r.suggestion === 'string' && r.suggestion.trim() ? r.suggestion.trim().slice(0, 600) : null });
        }
      }
    } catch {
      // a batch that cannot be parsed leaves its tasks pending
    }
  }
  return out;
}
