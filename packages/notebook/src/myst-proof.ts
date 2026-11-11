import { proofDirective } from 'myst-ext-proof';
import type { MystNode } from './myst.ts';

/** Display a parsed proof family without changing its authored title or body.
 * The upstream directive owns aliases, options, and the supported family list. */
export function mystProofHeading(node: MystNode): MystNode {
  const kind = typeof node.kind === 'string' ? node.kind : 'proof';
  const label = typeof node.numberingLabel === 'string' && node.numberingLabel
    ? node.numberingLabel : kind[0].toUpperCase() + kind.slice(1);
  const title = node.children?.find(child => child.type === 'admonitionTitle');
  return { type: 'strong', children: [
    { type: 'text', value: label },
    ...(title?.children?.length ? [{ type: 'text', value: ' (' }, ...title.children, { type: 'text', value: ')' }] : []),
  ] };
}

/** 1.0.14 applies common options after nonumber, overwriting its documented
 * precedence when both options are supplied. Correct only that parsed flag. */
export const mystProofDirective: typeof proofDirective = {
  ...proofDirective,
  run(data, ...args) {
    const nodes = proofDirective.run(data, ...args);
    if (data.options?.nonumber !== undefined) {
      for (const node of nodes) node.enumerated = !data.options.nonumber;
    }
    return nodes;
  },
};
