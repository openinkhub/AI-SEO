import { Logger } from '@nestjs/common';

const logger = new Logger('AiUsage');

// USD per million tokens [input, output]. Used only for the cost line in the logs.
const PRICES: Array<[RegExp, number, number]> = [
  [/haiku/i, 1, 5],
  [/opus/i, 15, 75],
  [/sonnet/i, 3, 15],
];

export type AiKind = 'task-writer' | 'evidence-reader' | 'strategy';

// The model for each kind of call. Write-ups are the most frequent calls, so they default to the cheaper Haiku;
// the screenshot reader and the strategy keep ANTHROPIC_MODEL (Sonnet by default) because accuracy matters most there.
export function aiModel(kind: AiKind): string {
  const base = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  if (kind === 'task-writer') return process.env.ANTHROPIC_TASK_MODEL || 'claude-haiku-4-5';
  if (kind === 'evidence-reader') return process.env.ANTHROPIC_EXTRACT_MODEL || base;
  return process.env.ANTHROPIC_STRATEGY_MODEL || base;
}

export function logAiUsage(kind: AiKind, model: string, usage?: { input_tokens?: number; output_tokens?: number }): void {
  const inp = usage?.input_tokens ?? 0;
  const out = usage?.output_tokens ?? 0;
  const p = PRICES.find(([re]) => re.test(model)) ?? [/./, 3, 15];
  const usd = (inp * p[1] + out * p[2]) / 1_000_000;
  logger.log(`${kind} ${model}: in ${inp} / out ${out} tokens = about $${usd.toFixed(3)}`);
}
