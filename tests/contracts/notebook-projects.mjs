// Shares the real Host/Notebook fixture with app-canvas.mjs; no second fake owner.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export const notebookProjectFixture = {
  id: 'project-contract', title: 'Actual Host research project', goal: 'Keep saved references', workspace: '/fixture/private-workspace',
  resources: [{ app: 'paper-agent', kind: 'paper', id: 'b'.repeat(64), revision: 'original-paper-digest' }],
};
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
  const resources = await host.request('projectresources', { name: 'notebook' });
  assert.equal(resources.ok, true, resources.error);
  assert.equal(resources.value.resources.find(item => item.reference.id === entry.id).location, `pero-app-location://notebook/main/entry/${entry.id}`);
  const unlinked = await call({ operation: 'apply', change: { ...change, revision: 2, expectedRevision: '2', linked: false } });
  assert.equal(unlinked.ok, true, unlinked.error); assert.deepEqual(unlinked.value.projects[0].entries, []);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')).workbench.research_projects[0].resources, notebookProjectFixture.resources);
  console.log('Notebook Host project contract: actual list, narrow association, saved-head/stale/readonly boundaries, persisted resources and owner navigation.');
}
