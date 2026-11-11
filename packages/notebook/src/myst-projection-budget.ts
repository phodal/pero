import type { MystNode } from './myst.ts';

/** Extra reference/TOC projection, shared by local and project resolution. Source
 * parsing has its own limit; repeated projections must not multiply that limit. */
export const MYST_PROJECTION_MAX_BYTES = 2 * 1024 * 1024;
export const MYST_PROJECTION_MAX_NODES = 20_000;
export interface MystProjectionCost { bytes: number; nodes: number }
export const projectionCost = (): MystProjectionCost => ({ bytes: 0, nodes: 0 });
export function escapedMystBytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    bytes += char === '&' ? 5 : char === '<' || char === '>' ? 4 : char === '"' ? 6 : char === "'" ? 5 : code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return bytes;
}
/** Include non-text payloads (image URLs/data, alt text, and nested attributes),
 * not just visible text. Traversal does not serialize or clone the payload. */
export function countMystProjection(value: unknown, cost: MystProjectionCost): void {
  if (typeof value === 'string') cost.bytes += escapedMystBytes(value);
  else if (Array.isArray(value)) for (const item of value) countMystProjection(item, cost);
  else if (value && typeof value === 'object') {
    if ('type' in value) { cost.nodes++; cost.bytes += 128; }
    for (const item of Object.values(value)) countMystProjection(item, cost);
  }
}
export class MystProjectionBudget {
  private bytes = 0;
  private nodes = 0;
  private reported = false;
  admit(cost: MystProjectionCost, report?: (code: string, message: string, node?: MystNode) => void, node?: MystNode): boolean {
    if (this.bytes + cost.bytes <= MYST_PROJECTION_MAX_BYTES && this.nodes + cost.nodes <= MYST_PROJECTION_MAX_NODES) {
      this.bytes += cost.bytes; this.nodes += cost.nodes; return true;
    }
    if (!this.reported && report) {
      this.reported = true;
      report('projection-limit', 'Reference/TOC expansion exceeds the document projection limit (2 MiB escaped content or 20,000 nodes); authored source is retained.', node);
    }
    return false;
  }
}
