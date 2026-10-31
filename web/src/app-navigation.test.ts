import test from 'node:test';
import assert from 'node:assert/strict';
import { admitPaperNavigation } from './app-navigation.ts';
const context = { name: 'scientific-viewer', panel: 'viewer', visible: true, origin: 'pero-app://scientific-viewer', expectedOrigin: 'pero-app://scientific-viewer' };
const request = { type: 'pero:app:navigate', id: 'request-1', target: 'paper-agent' };
test('visible authenticated Viewer can only navigate to Paper with no payload', () => {
  assert.equal(admitPaperNavigation(context, request), 'request-1');
  for (const change of [{ visible: false }, { name: 'other' }, { panel: 'other' }, { origin: 'https://attacker.invalid' }]) assert.equal(admitPaperNavigation({ ...context, ...change }, request), null);
  for (const change of [{ target: 'terminal' }, { target: '../paper-agent' }, { id: '' }, { file: 'private bytes' }, { query: 'implicit search' }]) assert.equal(admitPaperNavigation(context, { ...request, ...change }), null);
});
