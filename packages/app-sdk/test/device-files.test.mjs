import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createBrowserFileProvider, createDesktopFileProvider, planDeviceTransfer } from '../src/device-files.mjs';

const pdf = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const digest = createHash('sha256').update(pdf).digest('hex');
const gesture = { outcome: 'selected', handle: { id: 'handle-1', mediaType: 'application/pdf', size: pdf.length, name: 'note.pdf' } };

test('browser and desktop providers share the pick contract', () => {
  const browser = createBrowserFileProvider(() => true);
  const desktop = createDesktopFileProvider();
  const left = browser.pick(gesture);
  const right = desktop.pick(gesture);
  assert.equal(left.outcome, 'selected');
  assert.equal(right.outcome, 'selected');
  assert.equal(left.handle.id, right.handle.id);
  assert.equal(left.handle.provider, 'browser');
  assert.equal(right.handle.provider, 'desktop');
  assert.deepEqual(browser.pick({ outcome: 'cancelled' }), { outcome: 'cancelled' });
  assert.deepEqual(browser.pick({ outcome: 'denied' }), { outcome: 'denied' });
  assert.deepEqual(createBrowserFileProvider(() => false).pick(gesture), { outcome: 'offline' });
  assert.throws(() => desktop.pick({ ...gesture, path: '/tmp/note.pdf' }), error => error.code === 'traversal');
  const plan = planDeviceTransfer(right.handle, { uploadId: 'upload-1', project: 'lab', app: 'paper-agent', digest });
  assert.equal(plan.handleId, 'handle-1');
  assert.equal(plan.digest, digest);
  assert.equal('path' in plan, false);
});
