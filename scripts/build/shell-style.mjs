import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Desktop product HTML inlines the shell stylesheet, so tokens have to be prepended here. */
export function productShellStyle(root) {
  const tokens = readFileSync(resolve(root, 'packages/pero-design/src/tokens.css'), 'utf8');
  const shell = readFileSync(resolve(root, 'desktop/src/product/shell.css'), 'utf8');
  return `${tokens}\n${shell}`;
}
