import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseMystDocument } from '../../../packages/notebook/src/myst.ts';
import { renderMystHtml } from '../../../packages/notebook/src/myst-render.ts';
import { compileMystProject } from '../../../packages/notebook/src/myst-project.ts';
import { renderMystProjectHtml } from '../../../packages/notebook/src/myst-project-render.ts';
import { parseMystProjectSnapshot } from '../../../packages/notebook/src/myst-project-snapshot.ts';
import { parseIpynb } from '../../../packages/notebook/src/ipynb.ts';
import { renderIpynbHtml } from '../../../packages/notebook/src/ipynb-render.ts';
import { publicationPreviewHtml } from '../ui-src/publication-preview.ts';

const source = '---\nauthors:\n  - name: Researcher\n    affiliations: [lab]\naffiliations:\n  - id: lab\n    name: Institute\npero:\n  bibliography:\n    - id: study\n      title: Local study\n---\n(result)=\n# Findings\n\nSee {ref}`result`, {cite}`study`, [local](#result), [external](https://example.invalid/paper#part).\n\nAuthored ` href="#not-a-link"` stays text.';
const project = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'pages/article.md', files: [
  { path: 'pages/article.md', text: 'See {ref}`../notes.md#result`.\n\n```{include} ../notes.md\n```' },
  { path: 'notes.md', text: source },
] }));
const notebook = parseIpynb(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: 'findings', cell_type: 'markdown', metadata: {}, source }] }));

for (const [name, html] of [
  ['MyST', renderMystHtml(parseMystDocument(source))],
  ['project', renderMystProjectHtml(project)],
  ['notebook', renderIpynbHtml(notebook)],
]) test(`${name} preview fragment links stay within srcdoc without changing standalone exports`, () => {
  const standalone = new JSDOM(html, { url: 'https://publication.invalid/article.html' });
  // A srcdoc iframe inherits the embedding page URL as its fallback base.
  const preview = new JSDOM(publicationPreviewHtml(html), { url: 'https://app.invalid/#notebook-entry=one' });
  try {
    const originalLinks = [...standalone.window.document.querySelectorAll('a')];
    const previewLinks = [...preview.window.document.querySelectorAll('a')];
    assert.equal(previewLinks.length, originalLinks.length);
    assert.ok(originalLinks.some(link => link.getAttribute('href')?.startsWith('#')));
    assert.ok(originalLinks.some(link => link.getAttribute('href')?.includes('affiliation-1')));
    assert.ok(originalLinks.some(link => link.getAttribute('href')?.includes('citation-study')));
    for (let i = 0; i < originalLinks.length; i++) {
      const href = originalLinks[i].getAttribute('href')!;
      if (href.startsWith('#')) {
        assert.ok(standalone.window.document.getElementById(href.slice(1)), `Missing target ${href}`);
        assert.equal(previewLinks[i].href, `about:srcdoc${href}`);
        assert.ok(preview.window.document.getElementById(href.slice(1)), `Missing preview target ${href}`);
        assert.equal(originalLinks[i].href, `https://publication.invalid/article.html${href}`);
        previewLinks[i].setAttribute('href', href);
      } else assert.equal(previewLinks[i].href, originalLinks[i].href);
    }
    assert.equal(preview.serialize(), standalone.serialize(), 'Only generated fragment hrefs change');
    assert.equal(preview.window.document.querySelector('script, iframe, base'), null);
    assert.match(preview.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!, /default-src 'none'.*base-uri 'none'/);
    assert.match(preview.window.document.body.textContent!, /Authored `? href="#not-a-link"/);
  } finally { standalone.window.close(); preview.window.close(); }
});
