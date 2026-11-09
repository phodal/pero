import assert from 'node:assert/strict';
import test from 'node:test';
import { chemistryUnits, solveChemistry, type ChemistryInput, type ChemistryVariable } from '../src/science-chemistry.ts';

function input(fields: Partial<ChemistryInput['fields']>, target: ChemistryInput['target'] = 'amount'): ChemistryInput {
  return { target, significantFigures: 4, fields: { ...Object.fromEntries(Object.entries(chemistryUnits).map(([key, units]) => [key, { text: '', unit: Object.keys(units)[0] }])) as ChemistryInput['fields'], ...fields } };
}
test('dimensional equations convert units and transparently chain real relationships', () => {
  const cases: [ChemistryInput, number][] = [
    [input({ mass: { text: '180.16', unit: 'mg' }, formulaWeight: { text: '180.16', unit: 'g/mol' }, purity: { text: '98', unit: '%' }, amount: { text: 'ignored', unit: 'mmol' } }), 0.98],
    [input({ volume: { text: '2', unit: 'mL' }, molarity: { text: '0.5', unit: 'M' }, amount: { text: '', unit: 'mmol' } }), 1],
    [input({ amount: { text: '2', unit: 'mmol' }, formulaWeight: { text: '100', unit: 'g/mol' }, purity: { text: '0.5', unit: 'fraction' }, mass: { text: '', unit: 'mg' } }, 'mass'), 400],
    [input({ mass: { text: '2', unit: 'g' }, density: { text: '1', unit: 'g/mL' }, volume: { text: '', unit: 'mL' } }, 'volume'), 2],
    [input({ amount: { text: '2', unit: 'mmol' }, limitingAmount: { text: '1', unit: 'mmol' }, limitingEquivalence: { text: '1', unit: 'eq' } }, 'equivalence'), 2],
    [input({ volume: { text: '2', unit: 'mL' }, density: { text: '1', unit: 'g/mL' }, formulaWeight: { text: '100', unit: 'g/mol' }, purity: { text: '1', unit: 'fraction' } }), 0.02],
  ];
  for (const [request, expected] of cases) {
    const result = solveChemistry(request); assert.equal(result.status, 'solved');
    if (result.status === 'solved') { assert.ok(Math.abs(result.value - expected) < 1e-9); assert.equal(result.unit, request.fields[request.target].unit); }
  }
});
test('chemistry distinguishes missing dependencies, contradictory inputs and invalid quantities', () => {
  assert.equal(solveChemistry(input({})).status, 'missing');
  assert.throws(() => solveChemistry(input({ volume: { text: '1', unit: 'L' }, density: { text: '2', unit: 'g/L' }, mass: { text: '1', unit: 'g' } })), /Conflicting/);
  for (const [key, value, unit] of [['mass', '0', 'g'], ['mass', '-2', 'g'], ['mass', 'Infinity', 'g'], ['purity', '101', '%'], ['volume', '1', 'kg']] as const) {
    assert.throws(() => solveChemistry(input({ [key as ChemistryVariable]: { text: value, unit } })), /positive|Invalid|Unsupported/);
  }
  assert.throws(() => solveChemistry({ ...input({}), significantFigures: 0 }), /Significant/);
});
