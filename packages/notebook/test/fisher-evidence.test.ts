import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isFisherEvidenceReference, maxFisherReceiptBytes, readFisherEvidence } from '../src/fisher-evidence.ts';

const fixture = JSON.parse(await readFile(new URL('./fixtures/fisher-evidence-receipt.json', import.meta.url), 'utf8'));
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;

test('imports exact Fisher reference with a matching canonical digest', async () => {
  const { reference, snapshot } = await readFisherEvidence(encode(fixture));
  assert.deepEqual(snapshot, fixture.snapshot);
  assert.equal(reference.version, fixture.id);
  assert.equal(reference.locator, `pero-app-location://paper-agent/main/fisher/${snapshot.itemId}/attempt/${snapshot.attemptId}/receipt/${fixture.id}`);
  assert.equal(isFisherEvidenceReference(reference, snapshot), true);
  assert.equal(isFisherEvidenceReference({ ...reference, locator: reference.locator.replace(snapshot.attemptId, 'f'.repeat(32)) }, snapshot), false);
  assert.equal(isFisherEvidenceReference({ ...reference, locator: reference.locator + '?latest=1' }), false);
});

test('rejects edited Fisher evidence, unsupported contents, and large receipts', async () => {
  await assert.rejects(readFisherEvidence(encode({ ...fixture, snapshot: { ...fixture.snapshot, exactNumerator: 5 } })), /digest/);
  for (const changes of [{ page: 3 }, { paperVerdict: 'PASS' }, { exactDenominator: Number.MAX_SAFE_INTEGER + 1 }, { extra: 'text' }]) {
    await assert.rejects(readFisherEvidence(encode({ ...fixture, snapshot: { ...fixture.snapshot, ...changes } })), /Invalid/);
  }
  await assert.rejects(readFisherEvidence(new ArrayBuffer(maxFisherReceiptBytes + 1)), /4 KiB/);
});
