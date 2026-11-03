import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every public SDK entry resolves to this repository-owned implementation. */
export function appSdkAliases(root) {
  const directory = resolve(root, 'packages/app-sdk');
  const {exports} = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  return Object.fromEntries(['@pero/app-sdk'].flatMap(name => Object.entries(exports)
    .map(([entry,path]) => [entry === '.' ? name : name + entry.slice(1), resolve(directory,path)])));
}
