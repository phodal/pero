// Shares the real Host/Notebook fixture with app-canvas.mjs; no second fake owner.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFisherEvidence } from '../../packages/notebook/src/fisher-evidence.ts';
export const notebookProjectFixture = {
  id: 'project-contract', title: 'Actual Host research project', goal: 'Keep saved references', workspace: '/fixture/private-workspace',
  resources: [{ app: 'paper-agent', kind: 'paper', id: 'b'.repeat(64), revision: 'original-paper-digest' }],
};
// Optional: production Paper computation and checked receipt, never a synthesized
// result, input download, or execution of a previous archive's verifier.
async function actualFisherFinding() {
  if (!process.env.PERO_FISHER_PDF) return [];
  const receipt = execFileSync(process.env.PERO_APP_PYTHON, ['-c', `
import json, os
from pathlib import Path
from tempfile import TemporaryDirectory
from paper_agent.fisher_app import FisherApp
from paper_agent.fisher_records import notebook_evidence
from paper_agent.fisher_result import DOI, PDF_SHA256, PDF_URL
from paper_agent.model import PaperSnapshot
from paper_agent.pdf import PdfDocument
from paper_agent.pdf_files import PdfFiles
from paper_agent.store import ResearchStore

now = '2026-11-07T03:00:00Z'
with TemporaryDirectory() as home:
    store = ResearchStore(home)
    pdf = Path(os.environ['PERO_FISHER_PDF']).read_bytes()
    files = PdfFiles()
    paper = store.save_paper(PaperSnapshot.from_reading(dict(source='import', sourceId=DOI,
        title='Fisher (1936)', url='https://doi.org/' + DOI, contentKind='full-text',
        content='Original Fisher paper'), now))
    doc = store.save_pdf(PdfDocument.create(paper.id, PDF_SHA256, PDF_URL, files.pages(pdf), now), pdf)
    app = FisherApp(store, files)
    selection = app.command(dict(action='select', documentId=doc.id), now)
    frozen = app.command(dict(action='freeze', annotationId=selection['annotation']['id'],
        confirmed=True, comparison=dict(mode='absolute', tolerance=0)), now)
    attempt = app.command(dict(action='run', itemId=frozen['itemId'], specId=frozen['spec']['id'],
        requestId='notebook-project-contract', confirmed=True), now)
    ids = dict(itemId=frozen['itemId'], attemptId=attempt['attemptId'])
    receipt = notebook_evidence(store, ids)
    assert notebook_evidence(ResearchStore(home), dict(ids, receiptId=receipt['id'])) == receipt
    print(json.dumps(receipt))
`], { env: { ...process.env, PYTHONPATH: fileURLToPath(new URL('../../apps/paper-agent/backend', import.meta.url)) },
    timeout: 15_000, maxBuffer: 16_384 });
  const { reference, snapshot } = await readFisherEvidence(Uint8Array.from(receipt).buffer);
  assert.equal(snapshot.exactNumerator / snapshot.exactDenominator, 19.1434);
  assert.equal(snapshot.paperVerdict, 'NOT_ASSESSED');
  return [
    { type: 'evidence', attrs: { blockId: 'fisher-evidence', label: 'Fisher Table III', source: reference, snapshot } },
    { type: 'finding', attrs: { blockId: 'fisher-finding', claim: 'Recomputed one Table III statistic.',
      limitations: 'Not a whole-paper assessment.', evidenceIds: ['fisher-evidence'] } },
  ];
}

export async function verifyNotebookProjects(host, backend, settingsPath) {
  const entry = await backend('notebook', '/api/entries', { title: 'Real linked notebook' });
  const call = request => host.request('notebook-projects', { name: 'notebook', request });
  const catalog = await call({ operation: 'list' });
  assert.equal(catalog.ok, true, catalog.error);
  assert.deepEqual(catalog.value.projects, [{ id: notebookProjectFixture.id, title: notebookProjectFixture.title, entries: [] }]);
  assert(catalog.value.entries.some(item => item.id === entry.id && item.revision === '1'));
  assert(!JSON.stringify(catalog.value).includes('private-workspace'));
  assert(!JSON.stringify(catalog.value).includes('original-paper-digest'));
  const change = { projectId: notebookProjectFixture.id, entryId: entry.id, revision: 1, expectedRevision: null, linked: true, readOnly: false };
  const before = await readFile(settingsPath, 'utf8');
  const review = await call({ operation: 'review', change });
  assert.equal(review.ok, true, review.error); assert.match(review.value.summary, /Real linked notebook/); assert.match(review.value.summary, /Actual Host research project/);
  assert.equal(await readFile(settingsPath, 'utf8'), before, 'review must not mutate settings');
  assert.equal((await call({ operation: 'apply', change: { ...change, readOnly: true } })).ok, false);
  assert.equal((await host.request('notebook-projects', { name: 'data', request: { operation: 'list' } })).ok, false);
  const linked = await call({ operation: 'apply', change });
  assert.equal(linked.ok, true, linked.error); assert.deepEqual(linked.value.projects[0].entries, [{ id: entry.id, revision: '1' }]);
  const persisted = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.deepEqual(persisted.workbench.research_projects[0].resources[0], notebookProjectFixture.resources[0]);
  assert.equal(persisted.workbench.research_projects[0].workspace, notebookProjectFixture.workspace);
  assert.equal((await call({ operation: 'apply', change })).ok, false, 'stale original association cannot overwrite the owner');
  await backend('notebook', `/api/entries/${entry.id}`, { baseRevision: 1, document: { ...entry.document, title: 'Updated linked notebook' } });
  assert.equal((await call({ operation: 'apply', change: { ...change, expectedRevision: '1' } })).ok, false, 'old Notebook head cannot change an association');
  const updated = await call({ operation: 'apply', change: { ...change, revision: 2, expectedRevision: '1' } });
  assert.equal(updated.ok, true, updated.error);
  assert.deepEqual(updated.value.projects[0].entries, [{ id: entry.id, revision: '2' }]);
  const path = `/api/entries/${entry.id}`;
  const finding = await actualFisherFinding();
  const pinnedDocument = { ...entry.document, title: 'Pinned revision three',
    ...(finding.length ? { content: { type: 'doc', content: finding } } : {}) };
  await backend('notebook', path, { baseRevision: 2, document: pinnedDocument });
  const pin = await call({ operation: 'apply', change: { ...change, revision: 3, expectedRevision: '2' } });
  assert.equal(pin.ok, true, pin.error);
  await backend('notebook', path, { baseRevision: 3, document: { ...entry.document, title: 'Current revision four' } });
  const resources = await host.request('projectresources', { name: 'notebook' });
  assert.equal(resources.ok, true, resources.error);
  assert.equal(resources.value.resources.find(item => item.reference.id === entry.id).location, `pero-app-location://notebook/main/entry/${entry.id}/revision/4`);
  assert.deepEqual((await call({ operation: 'list' })).value.projects[0].entries, [{ id: entry.id, revision: '3' }]);
  const reopened = await backend('notebook', `${path}/revisions/3`);
  assert.equal(reopened.title, 'Pinned revision three');
  if (finding.length) {
    assert.deepEqual(reopened.document.content.content, finding);
    assert(!JSON.stringify((await backend('notebook', path)).document).includes('fisher-evidence'));
    console.log('Fisher → Notebook Finding → Project: real receipt retained only at the linked saved revision.');
  }
  const unlinked = await call({ operation: 'apply', change: { ...change, revision: 4, expectedRevision: '3', linked: false } });
  assert.equal(unlinked.ok, true, unlinked.error); assert.deepEqual(unlinked.value.projects[0].entries, []);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')).workbench.research_projects[0].resources, notebookProjectFixture.resources);
  console.log('Notebook Host project contract: actual list, narrow association, saved-head/stale/readonly boundaries, persisted resources and owner navigation.');
}
