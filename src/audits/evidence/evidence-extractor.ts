import { Logger } from '@nestjs/common';
import { buildExtractionPrompt, KNOWN_TYPES } from './aitdk-rules';
import { aiModel, logAiUsage } from '../ai-usage';

export interface ImageExtraction {
  type: string;
  data: Record<string, unknown>;
}

const logger = new Logger('EvidenceExtractor');

export function extractorConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// One vision call per screenshot. Returns {type, data}; throws with a readable message on failure.
export async function extractFromImage(buffer: Buffer, mime: string, tool?: string | null): Promise<ImageExtraction> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server, so screenshots cannot be read yet.');
  const model = aiModel('evidence-reader');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: mime === 'application/pdf' ? 16000 : 3000,
      messages: [
        {
          role: 'user',
          content: [
            mime === 'application/pdf'
              ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
              : { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
            { type: 'text', text: buildExtractionPrompt(tool) },
          ],
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  logAiUsage('evidence-reader', model, body.usage);
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    logger.warn(`Anthropic call failed: ${msg}`);
    throw new Error(`Screenshot reader failed: ${msg}`);
  }
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  return parseModelJson(text);
}

export function parseModelJson(text: string): ImageExtraction {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The reader returned no JSON.');
  let obj: { type?: unknown; data?: unknown };
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('The reader returned JSON that could not be parsed.');
  }
  const type = typeof obj.type === 'string' && KNOWN_TYPES.has(obj.type) ? obj.type : 'unknown';
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : {};
  return { type, data };
}
