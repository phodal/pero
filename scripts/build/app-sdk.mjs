import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every public SDK entry resolves to this repository-owned implementation. */
export function appSdkAliases(root) {
  return Object.fromEntries(['app-sdk', 'mcp-apps'].flatMap(packageName => {
    const directory = resolve(root, 'packages', packageName);
    const {name, exports} = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    return Object.entries(exports).map(([entry,path]) =>
      [entry === '.' ? name : name + entry.slice(1), resolve(directory,path)]);
  }));
}
