import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageBuiltinApp } from './builtin-app-payload.mjs';

test('Packaged Skills catalog is a sanitized file beside the app', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pero-skills-catalog-'));
  try {
    const output = join(directory, 'skills');
    stageBuiltinApp(join(import.meta.dirname, '../../apps/skills'), 'skills', output);
    const packaged = JSON.parse(readFileSync(join(output, 'market-catalog.json'), 'utf8'));
    const reviewed = JSON.parse(readFileSync(join(import.meta.dirname, '../../docs/design-docs/research-skills-catalog.json'), 'utf8'));
    assert.equal(packaged.schema_version, 1);
    assert.equal(packaged.skills.length, reviewed.skills.length);
    const sample = reviewed.skills.find(item => item.source?.sha256 && item.kind === 'research_skill');
    const packed = packaged.skills.find(item => item.id === sample.id);
    assert.equal(packed.source.sha256, sample.source.sha256);
    assert.equal(packed.source.commit, sample.source.commit);
    const text = JSON.stringify(packaged);
    assert.equal(text.includes('frontmatter_yaml'), false);
    assert.equal(text.includes('```'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
