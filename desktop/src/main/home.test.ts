import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignDefaultPython, migrateLegacyWorkbench, workbenchLocations } from './home.ts';

test('workbench locations use ~/.pero unless a profile or path override is set', () => {
  const home = '/home/pero';
  const userData = '/profiles/electron';
  assert.deepEqual(workbenchLocations({}, userData, home), {
    isolated: false,
    settings: '/home/pero/config/runtime-settings.json',
    apps: '/home/pero/apps',
    python: '/home/pero/environment/pero-default',
  });
  assert.equal(workbenchLocations({ PERO_DESKTOP_DATA_DIR: '/tmp/profile' }, userData, home).apps, join(userData, 'apps'));
  assert.equal(workbenchLocations({ PERO_APPS_ROOT: '/opt/apps', PERO_SETTINGS_PATH: '/opt/settings.json' }, userData, home).apps, '/opt/apps');
  assert.equal(workbenchLocations({ PERO_SETTINGS_PATH: '/opt/settings.json' }, userData, home).settings, '/opt/settings.json');
});

test('legacy Electron apps, domain data and settings move once into the home', () => {
  const root = mkdtempSync(join(tmpdir(), 'pero-home-'));
  const userData = join(root, 'electron');
  const home = join(root, 'dot-pero');
  mkdirSync(join(userData, 'apps/paper-agent'), { recursive: true });
  writeFileSync(join(userData, 'apps/paper-agent/app.json'), '{"name":"paper-agent"}');
  mkdirSync(join(userData, 'app-data/paper-agent'), { recursive: true });
  writeFileSync(join(userData, 'app-data/paper-agent/draft.txt'), 'kept');
  writeFileSync(join(userData, 'runtime-settings.json'), '{"locale":"zh-CN"}\n');
  const locations = workbenchLocations({}, userData, home);
  migrateLegacyWorkbench(userData, locations, home);
  migrateLegacyWorkbench(userData, locations, home);
  assert.equal(readFileSync(join(home, 'apps/paper-agent/app.json'), 'utf8'), '{"name":"paper-agent"}');
  assert.equal(readFileSync(join(home, 'app-data/paper-agent/draft.txt'), 'utf8'), 'kept');
  assert.equal(readFileSync(locations.settings, 'utf8'), '{"locale":"zh-CN"}\n');
  assert.equal(existsSync(join(userData, 'apps')), false);
  const isolated = workbenchLocations({ PERO_DESKTOP_DATA_DIR: userData }, userData, home);
  mkdirSync(join(userData, 'apps'), { recursive: true });
  writeFileSync(join(userData, 'apps/stay.txt'), 'profile');
  migrateLegacyWorkbench(userData, isolated, home);
  assert.equal(existsSync(join(userData, 'apps/stay.txt')), true);
  rmSync(root, { recursive: true, force: true });
});

test('default Python is recorded without replacing an existing choice or other settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'pero-python-settings-'));
  const settings = join(root, 'runtime-settings.json');
  writeFileSync(settings, '{"locale":"zh-CN","app_python":{"apps":{"paper-agent":"/tmp/paper"}}}\n');
  assignDefaultPython(settings, '/home/pero/environment/pero-default');
  const merged = JSON.parse(readFileSync(settings, 'utf8'));
  assert.equal(merged.locale, 'zh-CN');
  assert.equal(merged.app_python.default, '/home/pero/environment/pero-default');
  assert.equal(merged.app_python.apps['paper-agent'], '/tmp/paper');
  assignDefaultPython(settings, '/other');
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).app_python.default, '/home/pero/environment/pero-default');
  rmSync(root, { recursive: true, force: true });
});
