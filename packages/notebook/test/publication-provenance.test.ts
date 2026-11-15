import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseMystProjectSnapshot, replaceMystProjectResource } from '../src/myst-project-snapshot.ts';
import { publicationProvenance } from '../src/publication-provenance.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
test('panel provenance binds figure bytes, code and data to one frozen publication', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const figures = [{ id: 'fig-study', path: 'figure.svg', sha256: hash(svg), panels: [{
    id: 'a', label: 'Measurements', data: [{ path: 'data.csv', sha256: hash('x,y\n1,2') }],
    code: [{ path: 'figure.py', sha256: hash('plot(data)'), locator: 'panel_a' }],
  }] }];
  const snapshot = parseMystProjectSnapshot({ format: 'pero-myst-project', version: 2, entry: 'article.md', files: [
    { path: 'article.md', text: 'See {ref}`fig-study`.' }, { path: 'data.csv', text: 'x,y\n1,2' },
    { path: 'figure.py', text: 'plot(data)' },
    { path: 'publication-provenance.json', text: JSON.stringify({ format: 'pero-publication-provenance', version: 1, figures }) },
  ], assets: [{ path: 'figure.svg', mediaType: 'image/svg+xml', base64: btoa(svg) }] });
  assert.deepEqual(await publicationProvenance(snapshot), { figures, problems: [] });
  for (const [path, text] of [['data.csv', 'x,y\n1,3'], ['figure.py', 'plot(other)']]) {
    const changed = replaceMystProjectResource(snapshot, path, text);
    assert.match((await publicationProvenance(changed)).problems[0], new RegExp(`${path} changed.*Regenerate`));
    assert.deepEqual((await publicationProvenance(snapshot)).problems, [], 'Old figure/input version stays valid');
  }
  const missing = { ...snapshot, files: snapshot.files.filter(file => file.path !== 'data.csv') };
  assert.match((await publicationProvenance(missing)).problems[0], /missing data.csv/);
  await assert.rejects(publicationProvenance(replaceMystProjectResource(snapshot, 'publication-provenance.json', '{"version":99}')), /Unsupported/);
});
