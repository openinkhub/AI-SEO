// Turns a Skill Matrix "Layer Mapping" free-text cell into a structured
// number[]. Handles:
//   "Layer 21"                         -> [21]
//   "Layer 21/22"                      -> [21, 22]
//   "Layers 26/27/29/69"               -> [26, 27, 29, 69]
//   "Layers 4–14"                      -> [4, 5, ..., 14]  (en-dash range)
//   "Layer 21 (Blog Image) / Layer 22" -> [21, 22] (two separate mentions)
//   "N/A — ..." / "Propose new — ..."  -> []  (no existing layer to push to)
//
// Scans the WHOLE string for every "Layer"/"Layers" mention rather than
// trying to classify the cell up front — this correctly pulls [21,23,24,
// 25,28,60] out of cells like "Existing: ... (Layers 21/23/24/25/28/60) —
// ... is Propose new — Backlink Outreach Layer", where the back half of
// the sentence has no number and contributes nothing.
export function parseLayerNumbers(raw: string): number[] {
  if (!raw) return [];
  const numbers = new Set<number>();
  const layerBlockRegex = /Layers?\s+([0-9][0-9/\-–\s]*[0-9]|[0-9]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = layerBlockRegex.exec(raw)) !== null) {
    const block = match[1];
    const wholeRange = block.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (wholeRange) {
      addRange(numbers, wholeRange[1], wholeRange[2]);
      continue;
    }
    const parts = block.split(/[/\s]+/).filter(Boolean);
    for (const part of parts) {
      const partRange = part.match(/^(\d+)[-–](\d+)$/);
      if (partRange) {
        addRange(numbers, partRange[1], partRange[2]);
      } else if (/^\d+$/.test(part)) {
        numbers.add(parseInt(part, 10));
      }
    }
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

function addRange(set: Set<number>, startStr: string, endStr: string): void {
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  // Guard against a pathological cell turning into a huge loop.
  if (hi - lo > 200) return;
  for (let n = lo; n <= hi; n++) set.add(n);
}
