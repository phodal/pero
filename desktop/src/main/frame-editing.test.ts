import assert from 'node:assert/strict';
import test from 'node:test';
import { appFrameEdit } from './frame-editing.ts';

const key = (changes: Partial<{ key: string; meta: boolean; control: boolean; alt: boolean; shift: boolean; type: string }> = {}) => ({
  type: 'keyDown', key: 'c', meta: true, control: false, alt: false, shift: false, ...changes,
});

test('app iframe copy and paste follow the platform shortcut', () => {
  assert.equal(appFrameEdit(key(), 'pero-app://paper-agent/', 'darwin'), 'copy');
  assert.equal(appFrameEdit(key({ key: 'v' }), 'pero-app://paper-agent/main', 'darwin'), 'paste');
  assert.equal(appFrameEdit(key({ key: 'x' }), 'pero-app://paper-agent/', 'darwin'), 'cut');
  assert.equal(appFrameEdit(key({ key: 'a' }), 'pero-app://paper-agent/', 'darwin'), 'selectAll');
  assert.equal(appFrameEdit(key({ meta: false, control: true }), 'pero-app://paper-agent/', 'win32'), 'copy');
  assert.equal(appFrameEdit(key({ meta: false, control: true }), 'pero-app://paper-agent/', 'darwin'), null);
  assert.equal(appFrameEdit(key(), 'pero://workbench/', 'darwin'), null);
  assert.equal(appFrameEdit(key({ shift: true }), 'pero-app://paper-agent/', 'darwin'), null);
  assert.equal(appFrameEdit(key({ type: 'keyUp' }), 'pero-app://paper-agent/', 'darwin'), null);
});
