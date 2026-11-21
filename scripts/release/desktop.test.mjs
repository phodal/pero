import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { createMacOSDmg } from '../lib/macos-dmg.mjs';

test('release verification rejects a DMG missing Paper’s plugin even when the staged App is valid', { skip: process.platform !== 'darwin' }, () => {
  const source = resolve(import.meta.dirname, '../..');
  const root = mkdtempSync(join(tmpdir(), 'pero-release-verification-'));
  try {
    const put = (path, value) => {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    };
    for (const path of ['scripts/release/desktop.mjs', 'scripts/lib/macos-dmg.mjs', 'scripts/build/builtin-app-payload.mjs', 'packages/product/product.ts']) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(join(source, path), join(root, path));
    }
    const env = { PATH: process.env.PATH, HOME: root, TMPDIR: join(root, 'mounts'), GIT_CONFIG_NOSYSTEM: '1', GITHUB_ACTIONS: 'true', RELEASE_TAG: 'v0.1.0-fixture' };
    mkdirSync(env.TMPDIR);
    const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'fixture');
    git('tag', env.RELEASE_TAG);
    put('products/pero.json', { schemaVersion: 1, id: 'com.openpero.desktop', name: 'Pero', version: '0.1.0', shell: 'workbench', apps: ['paper-agent'], python: 'system' });
    const payload = 'target/package/Pero.app/Contents/Resources/app';
    const paper = payload + '/apps/paper-agent';
    const app = join(root, 'target/package/Pero.app');
    const archive = join(root, 'target/package', `Pero-macos-${process.arch}.dmg`);
    const checksums = archive.replace(/\.dmg$/, '.SHA256SUMS');
    put('target/package/size.json', { dmgBytes: 1 });
    put('target/package/Pero.app/Contents/Info.plist', '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openpero.desktop</string><key>CFBundleExecutable</key><string>Pero</string></dict></plist>');
    put(payload + '/desktop/dist/release.json', { sourceRevision: git('rev-parse', 'HEAD'), releaseTag: env.RELEASE_TAG, taskCenter: 'https://app.openpero.com', productId: 'com.openpero.desktop', platform: 'darwin', arch: process.arch, buildProvider: 'GitHub Actions' });
    put(payload + '/desktop/dist/main.cjs', 'const taskCenter = "https://app.openpero.com";');
    put(paper + '/app.json', { requiresAgentPlugins: ['paper-autoresearch'] });
    mkdirSync(join(app, 'Contents/MacOS'));
    mkdirSync(join(root, payload, 'bin'));
    put('main.c', 'int main(void) { return 0; }');
    execFileSync('/usr/bin/clang', ['-arch', process.arch === 'x64' ? 'x86_64' : process.arch, '-o', join(app, 'Contents/MacOS/Pero'), join(root, 'main.c')]);
    copyFileSync(join(app, 'Contents/MacOS/Pero'), join(root, payload, 'bin/pero-host'));
    const sign = () => execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    const verify = () => spawnSync(process.execPath, ['scripts/release/desktop.mjs', 'verify'], { cwd: root, env, encoding: 'utf8' });
    sign();
    createMacOSDmg(app, 'Pero', archive);
    put(paper + '/agent-plugins/paper-autoresearch/plugin.json', { schemaVersion: 1, name: 'paper-autoresearch', skills: ['SKILL.md'] });
    put(paper + '/agent-plugins/paper-autoresearch/SKILL.md', 'packaged research skill');
    sign();

    const rejected = verify();
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stderr, /paper-agent payload .*Agent Plugin paper-autoresearch: plugin\.json/);
    assert.equal(existsSync(checksums), false);
    assert.deepEqual(readdirSync(env.TMPDIR), []);

    createMacOSDmg(app, 'Pero', archive);
    const accepted = verify();
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.equal(existsSync(checksums), true);
    assert.deepEqual(readdirSync(env.TMPDIR), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
