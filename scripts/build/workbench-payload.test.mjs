import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageWorkbenchWeb } from './workbench-payload.mjs';

test('Workbench payload drops standalone Chat while retaining its own runtime and shared assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pero-workbench-web-'));
  try {
    const source = join(directory, 'source');
    const destination = join(directory, 'payload');
    mkdirSync(join(source, 'assets'), { recursive: true });
    const files = [
      ['index.html', 'workbench entry', true],
      ['chat.html', 'standalone Chat entry', false],
      ['assets/workbench-HASH.js', 'workbench code', true],
      ['assets/workbench-HASH.css', 'workbench styles', true],
      ['assets/pero_ui_bg-HASH.wasm', 'workbench runtime', true],
      ['assets/locales-HASH.js', 'shared locale and theme data', true],
      ['assets/chat-HASH.js', 'standalone Chat code', false],
      ['assets/chat-HASH.css', 'standalone Chat styles', false],
      ['assets/pero_chat_web_bg-HASH.wasm', 'standalone Chat runtime', false],
    ];
    for (const [name, content] of files) writeFileSync(join(source, name), content);
    stageWorkbenchWeb(source, destination);
    assert.deepEqual(readdirSync(destination).sort(), ['assets', 'index.html']);
    assert.deepEqual(readdirSync(join(destination, 'assets')).sort(), files.filter(([name, , included]) => included && name.startsWith('assets/')).map(([name]) => name.slice('assets/'.length)).sort());
    for (const [name, content, included] of files) {
      assert.equal(readFileSync(join(source, name), 'utf8'), content, `development output retains ${name}`);
      if (included) assert.equal(readFileSync(join(destination, name), 'utf8'), content);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Builtin staging ships only the exact Paper CLI and skill additions', async () => {
  const { stageBuiltinApp } = await import('./builtin-app-payload.mjs');
  const { existsSync, symlinkSync } = await import('node:fs');
  const paperEntries = ['tools/research.py', 'skills/research-resource-import/SKILL.md',
    'skills/paper-code-audit/SKILL.md', 'skills/paper-code-audit/references/audit-contract.md',
    'skills/paper-code-audit/references/other-cases.md', 'skills/paper-code-audit/references/pcgym-table6.md'];
  const directory = mkdtempSync(join(tmpdir(), 'pero-builtin-payload-'));
  try {
    const source = join(directory, 'source');
    const files = ['app.json', 'backend/server.py', 'backend/__pycache__/server.pyc', 'dist/index.html',
      ...paperEntries, 'tools/unrelated.py', 'skills/paper-code-audit/references/private.md',
      'skills/other/SKILL.md', 'node_modules/private.js'];
    for (const path of files) {
      mkdirSync(join(source, path, '..'), { recursive: true }); writeFileSync(join(source, path), path);
    }
    for (const app of ['paper-agent', 'other-app']) {
      const output = join(directory, app); stageBuiltinApp(source, app, output);
      for (const path of files) {
        const included = ['app.json', 'backend/server.py', 'dist/index.html'].includes(path) || app === 'paper-agent' && paperEntries.includes(path);
        assert.equal(existsSync(join(output, path)), included, `${app}: ${path}`);
        if (included) assert.equal(readFileSync(join(output, path), 'utf8'), path);
      }
    }
    for (const entry of paperEntries) {
      rmSync(join(source, entry));
      assert.throws(() => stageBuiltinApp(source, 'paper-agent', join(directory, 'missing-entry')), /requires a regular file/);
      writeFileSync(join(source, entry), entry);
    }
    rmSync(join(source, 'tools/research.py'));
    assert.throws(() => stageBuiltinApp(source, 'paper-agent', join(directory, 'missing')), /requires a regular file/);
    if (process.platform !== 'win32') {
      writeFileSync(join(directory, 'outside.py'), 'not a packaged CLI'); symlinkSync(join(directory, 'outside.py'), join(source, 'tools/research.py'));
      assert.throws(() => stageBuiltinApp(source, 'paper-agent', join(directory, 'escaping')), /requires a regular file/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Staged Paper CLI executes references-only commit and export using its staged backend', async () => {
  const { stageBuiltinApp } = await import('./builtin-app-payload.mjs');
  const { execFileSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'pero-paper-cli-payload-'));
  try {
    const payload = join(directory, 'installed', 'paper-agent'), cache = join(directory, 'cache');
    stageBuiltinApp(resolve(import.meta.dirname, '../../apps/paper-agent'), 'paper-agent', payload);
    const python = process.env.PERO_TEST_PYTHON || 'python3';
    const seed = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom paper_agent.store import ResearchStore\nfrom paper_agent.research_resources import ImportDraft,ResearchResource\nstore=ResearchStore(Path(sys.argv[2]))\nurl='https://example.org/frozen-paper.pdf'\nresource=ResearchResource.linked(url,'https://example.org/research','Frozen PDF')\ndraft=ImportDraft.create(url,'2026-11-01T00:00:00Z').finish((resource,),())\nstore.imports._replace('import-drafts',draft.id,draft.to_dict())\nprint(json.dumps(dict(draftId=draft.id,resourceId=resource.id)))\n`;
    const ids = JSON.parse(execFileSync(python, ['-I', '-c', seed, join(payload, 'backend'), cache], { encoding: 'utf8', cwd: directory }));
    const call = request => JSON.parse(execFileSync(python, ['-I', join(payload, 'tools/research.py'), '--cache', cache], { input: JSON.stringify(request), encoding: 'utf8', cwd: directory }));
    const committed = call({ action: 'commit', input: { draftId: ids.draftId, resourceIds: [ids.resourceId], downloadIds: [], pdfIds: [], sourceIds: [], confirmedDownloads: false } });
    assert.equal(committed.ok, true); assert.equal(committed.code, 0);
    assert.deepEqual(committed.result.pdfDownloadIds, []); assert.deepEqual(committed.result.sourceDownloadIds, []);
    const exported = call({ action: 'export', input: { bundleId: committed.result.id } });
    assert.equal(exported.ok, true); assert.equal(exported.result.schema, 'pero.research-evidence.v1');
    assert.equal(exported.result.acquisitions[0].status, 'reference_only');
    assert.equal(exported.result.bundle.resources[0].originalUrl, 'https://example.org/frozen-paper.pdf');
    assert.match(readFileSync(join(payload, 'skills/research-resource-import/SKILL.md'), 'utf8'), /research-resource-import/);
    const auditDirectory = join(payload, 'skills/paper-code-audit');
    const auditSkill = readFileSync(join(auditDirectory, 'SKILL.md'), 'utf8');
    const references = [...auditSkill.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]);
    assert.deepEqual(references.sort(), ['references/audit-contract.md', 'references/other-cases.md', 'references/pcgym-table6.md']);
    for (const reference of references) assert.ok(readFileSync(join(auditDirectory, reference), 'utf8').length > 0);
    assert.match(auditSkill, /catalog reads SKILL.md only/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
