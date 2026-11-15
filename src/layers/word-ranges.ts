// Blog length rules (Admin guidance + live counter; a blog outside its range is flagged, not blocked).
// Layer 21 Website Blog 1000-1200 | Layer 23 Blog Tier 1 800-1000 | Layer 24 Blog Tier 2 600-800 | Layer 25 Blog Tier 3 600 (570-630 accepted).
export const WORD_RANGES: Record<number, { min: number; max: number; target: number; label: string }> = {
  21: { min: 1000, max: 1200, target: 1100, label: '1000-1200 words' },
  23: { min: 800, max: 1000, target: 900, label: '800-1000 words' },
  24: { min: 600, max: 800, target: 700, label: '600-800 words' },
  25: { min: 570, max: 630, target: 600, label: '600 words (570-630)' },
};
export function wordState(layerNo: number, words: number): 'under' | 'ok' | 'over' | 'empty' {
  const r = WORD_RANGES[layerNo];
  if (!words) return 'empty';
  if (!r) return 'ok';
  return words < r.min ? 'under' : words > r.max ? 'over' : 'ok';
}
