import assert from 'node:assert/strict';
import test from 'node:test';
import { assignPlate, createPlate } from '../src/science-plate.ts';
import { chemicalDerivation, chemicalMolfile, embedReactionMolecule, emptyPlateMetadata, exportChemical, importChemical, parseChemicalEmbedding, parseMolecularGraph, parsePlateDesign, parseReactionDefinition, parseReactionRecord, removeChemicalAtom, setChemicalBond, type MolecularGraph, type ReactionRecord } from '../src/scientific-designs.ts';

const graph = (): MolecularGraph => ({ atoms: [{ id: 'c', element: 'C', x: 120, y: 160, charge: 0 }, { id: 'o', element: 'O', x: 200, y: 160, charge: -1 }], bonds: [{ id: 'b', from: 'c', to: 'o', order: 1 }] });
const definition = () => ({ name: 'Explicit graph change', notes: 'Not chemically validated', molecules: [{ id: 'left', name: 'Starting graph', role: 'reactant', graph: graph() }, { id: 'right', name: 'Final graph', role: 'product', graph: graph() }] });

test('plate design metadata and assignments retain independent reusable values through JSON exchange', () => {
  const layout = assignPlate(createPlate(32, 48), [0, 1535], 'Control', 'replace');
  const input = { name: 'Screen', description: 'Layout only', layout, metadata: { ...emptyPlateMetadata(), wellVolumeMicroliters: 20, barcode: 'P-42', fields: [{ key: 'Lot', value: '2026' }] }, origin: { id: 'source-design', revision: 3 } };
  const design = parsePlateDesign(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(design, input); assert.deepEqual(design.layout.groups.AF48, ['Control']);
  design.layout.groups.A1.push('Changed'); assert.deepEqual(input.layout.groups.A1, ['Control']);
  for (const mutate of [
    (x: any) => x.layout.groups.A01 = ['A'], (x: any) => x.layout.groups.AG1 = ['A'],
    (x: any) => x.metadata.wellVolumeMicroliters = 0, (x: any) => x.metadata.wellVolumeMicroliters = NaN,
    (x: any) => x.metadata.fields.push({ key: ' lot ', value: 'Duplicate' }), (x: any) => x.layout.groups.A1 = [],
    (x: any) => x.origin.revision = 0,
  ]) { const invalid = structuredClone(input); mutate(invalid); assert.throws(() => parsePlateDesign(invalid)); }
});

test('graph transitions update bond identity and remove only incident bonds', () => {
  const initial = graph(), double = setChemicalBond(initial, 'o', 'c', 2, 'new');
  assert.equal(double.bonds[0].id, 'b'); assert.equal(double.bonds[0].order, 2); assert.equal(initial.bonds[0].order, 1);
  assert.deepEqual(removeChemicalAtom(double, 'o'), { atoms: [initial.atoms[0]], bonds: [] });
  assert.deepEqual(setChemicalBond(initial, 'o', 'c', 0, 'new').bonds, []);
  assert.throws(() => setChemicalBond(initial, 'gone', 'c', 1, 'x'));
  for (const mutate of [
    (g: any) => g.atoms.push(g.atoms[0]), (g: any) => g.atoms[0].x = Infinity,
    (g: any) => g.atoms[0].element = 'Fe', (g: any) => g.atoms[0].charge = 1.5,
    (g: any) => g.bonds[0].to = 'missing', (g: any) => g.bonds[0].order = 4,
    (g: any) => g.bonds.push({ id: 'duplicate', from: 'o', to: 'c', order: 1 }),
    (g: any) => g.atoms[0].stereo = 'R',
  ]) { const invalid = graph(); mutate(invalid); assert.throws(() => parseMolecularGraph(invalid)); }
});

test('reaction submission is stricter than saved editable draft and rejects invalid inputs', () => {
  const reaction = parseReactionDefinition(definition(), true);
  assert.deepEqual(parseReactionDefinition(JSON.parse(JSON.stringify(reaction)), true), reaction);
  assert.doesNotThrow(() => parseReactionDefinition({ name: '', notes: '', molecules: [] }));
  for (const mutate of [
    (r: any) => r.molecules.pop(), (r: any) => r.name = '', (r: any) => r.molecules[1].graph = { atoms: [], bonds: [] },
    (r: any) => r.molecules[1].role = 'validated', (r: any) => r.molecules[1].id = 'left',
  ]) { const invalid = definition(); mutate(invalid); assert.throws(() => parseReactionDefinition(invalid, true)); }
});

test('chemical embedding preserves pinned original graph and labels later edits as derivations', () => {
  const record = parseReactionRecord({ id: 'reaction', revision: 2, savedAt: '2026-11-09T12:00:00+00:00', definition: definition() }) as ReactionRecord;
  const chemical = embedReactionMolecule(record, 'left');
  assert.equal(chemicalDerivation(chemical), 'unverified', 'An imported record or supplied pin is not a local-owner lookup');
  assert.equal(chemicalDerivation(chemical, record), 'extracted');
  chemical.graph.atoms[1].charge = 0;
  assert.equal(chemicalDerivation(chemical, record), 'modified'); assert.equal(chemical.source?.original.atoms[1].charge, -1);
  assert.equal(record.definition.molecules[0].graph.atoms[1].charge, -1);
  assert.deepEqual(importChemical(exportChemical(chemical)), chemical);
  for (const mutate of [
    (value: any) => value.source.id = 'nonexistent', (value: any) => value.source.revision = 999,
    (value: any) => value.source.moleculeId = 'missing',
    (value: any) => { value.graph.atoms[0].element = 'N'; value.source.original.atoms[0].element = 'N'; },
  ]) {
    const altered = embedReactionMolecule(record, 'left'); mutate(altered);
    const imported = importChemical(exportChemical(altered));
    assert.equal(chemicalDerivation(imported), 'unverified');
    assert.equal(chemicalDerivation(imported, record), 'unverified');
    assert.deepEqual(imported.source, altered.source, 'Unresolved portable provenance is retained');
  }
  const reordered = embedReactionMolecule(record, 'left');
  reordered.source!.original = JSON.parse(JSON.stringify(reordered.source!.original, ['bonds', 'atoms', 'charge', 'y', 'x', 'element', 'id', 'order', 'to', 'from']));
  assert.equal(chemicalDerivation(reordered, record), 'extracted', 'JSON property order is not source identity');
  const mol = chemicalMolfile({ ...chemical, graph: graph() });
  assert.match(mol, /  2  1.*V2000/); assert.match(mol, /M  CHG  1   2  -1/); assert.match(mol, /M  END\n$/);
  assert.throws(() => embedReactionMolecule(record, 'missing'));
  assert.throws(() => importChemical('{"format":"molfile","chemical":{}}'));
  assert.throws(() => importChemical('x'.repeat(262145)));
  assert.throws(() => parseChemicalEmbedding({ ...chemical, verified: true }));
});
