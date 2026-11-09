import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMixturePreparation, editMixtureRecipe, saveMixtureRecipe, recordMixturePreparation, parseMixturePreparation, mixtureQSEstimate, convertMixtureQuantity } from '../src/mixture.ts';
function recipe() {
  const state = emptyMixturePreparation();
  state.draft = { name: 'Buffer', target: { value: 100, unit: 'mL' }, output: 'batch-a', notes: '', additiveVolumes: true, ingredients: [
    { id: 'stock', reference: 'stock-1', source: 'bottle-1', mode: 'quantity', target: { value: .02, unit: 'L' } },
    { id: 'water', reference: 'water-1', source: 'bottle-2', mode: 'qs', target: { value: null, unit: 'mL' } },
  ] }; return state;
}
test('quantities preserve unknowns, convert explicit units, and reject incompatible dimensions', () => {
  assert.equal(convertMixtureQuantity({ value: 2500, unit: 'mg' }, 'g'), 2.5);
  assert.equal(convertMixtureQuantity({ value: null, unit: 'mL' }, 'L'), null);
  assert.throws(() => convertMixtureQuantity({ value: 5, unit: 'g' }, 'mL'), /dimensions/);
  for (const value of [-1, Infinity, NaN, 1e13, '2']) {
    const state = recipe(); state.draft.target.value = value as number;
    assert.throws(() => parseMixturePreparation(state));
  }
});
test('QS arithmetic is conditional, bounded, dimensional, and never a measured amount', () => {
  const state = recipe(); assert.deepEqual(mixtureQSEstimate(state.draft), { value: 80, unit: 'mL' });
  assert.deepEqual(state.measurements, {});
  state.draft.additiveVolumes = false; assert.equal(mixtureQSEstimate(state.draft)?.value, null);
  state.draft.additiveVolumes = true; state.draft.ingredients[0].target.value = .2;
  assert.throws(() => saveMixtureRecipe(state), /exceed/);
  state.draft.ingredients[0].target = { value: 2, unit: 'g' };
  assert.throws(() => saveMixtureRecipe(state), /dimensions/);
  state.draft.additiveVolumes = false; assert.doesNotThrow(() => saveMixtureRecipe(state));
});
test('actual records require measurements and preserve recipe revision independently of later drafts', () => {
  let state = saveMixtureRecipe(recipe());
  const input = { id: 'record-1', expectedRecipeRevision: 1, expectedDraft: structuredClone(state.draft), operator: 'Researcher', recordedAt: '2026-11-09T12:00:00.000Z', output: 'batch-a', notes: 'Measured at bench' };
  assert.throws(() => recordMixturePreparation(state, input), /actual quantities/);
  state.measurements = { stock: { value: 21, unit: 'mL' }, water: { value: .079, unit: 'L' } };
  state = recordMixturePreparation(state, input);
  const receipt = JSON.stringify(state.records[0]);
  state.draft.notes = 'Updated protocol'; state.measurements.stock.value = 22;
  assert.equal(JSON.stringify(state.records[0]), receipt);
  assert.throws(() => recordMixturePreparation(state, { ...input, id: 'record-2' }), /Recipe changed/);
  state = saveMixtureRecipe(state);
  assert.throws(() => recordMixturePreparation(state, { ...input, id: 'record-2' }), /Recipe changed/);
  assert.deepEqual(parseMixturePreparation(JSON.parse(JSON.stringify(state))), state);
  state.records[0].recipe.name = 'Tampered'; assert.throws(() => parseMixturePreparation(state), /preserve/);
});

test('editing recipe clears stale measurements but never changes a recorded preparation', () => {
  const state = recipe(); state.measurements.stock = { value: 20, unit: 'mL' };
  const next = editMixtureRecipe(state, { ...state.draft, additiveVolumes: false });
  assert.deepEqual(next.measurements, {}); assert.deepEqual(state.measurements.stock, { value: 20, unit: 'mL' });
});
