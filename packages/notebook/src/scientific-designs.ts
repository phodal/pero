import { createPlate, plateWellIndex, plateWellName, type PlateLayout } from './science-plate.ts';

/** Local design records, not inventory, chemical registration or scientific verification. */
export interface RecordPin { id: string; revision: number }
export interface PlateMetadata { barcode: string; plateType: string; wellVolumeMicroliters: number | null; fields: { key: string; value: string }[] }
export interface PlateDesign { name: string; description: string; metadata: PlateMetadata; layout: PlateLayout; origin: RecordPin | null }
export interface LocalScientificRecord<T> { id: string; revision: number; savedAt: string; definition: T }
export type PlateDesignRecord = LocalScientificRecord<PlateDesign>;
export const chemicalElements = ['H', 'B', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Br', 'I'] as const;
export type ChemicalElement = typeof chemicalElements[number];
export interface ChemicalAtom { id: string; element: ChemicalElement; x: number; y: number; charge: number }
export interface ChemicalBond { id: string; from: string; to: string; order: 1 | 2 | 3 }
export interface MolecularGraph { atoms: ChemicalAtom[]; bonds: ChemicalBond[] }
export interface ReactionMolecule { id: string; name: string; role: 'reactant' | 'product' | 'agent'; graph: MolecularGraph }
export interface ReactionDefinition { name: string; notes: string; molecules: ReactionMolecule[] }
export type ReactionRecord = LocalScientificRecord<ReactionDefinition>;
/** Portable supplied provenance, unverified until matched against the local owner. */
export interface ChemicalSource extends RecordPin { moleculeId: string; original: MolecularGraph }
export interface ChemicalEmbedding { name: string; graph: MolecularGraph; source: ChemicalSource | null }
export interface ReactionAttributes { reaction: ReactionDefinition; record: ReactionRecord | null }

export const emptyPlateMetadata = (): PlateMetadata => ({ barcode: '', plateType: '', wellVolumeMicroliters: null, fields: [] });
export const emptyMolecularGraph = (): MolecularGraph => ({ atoms: [], bonds: [] });
export const emptyReaction = (): ReactionDefinition => ({ name: '', notes: '', molecules: [] });
export const chemicalLimits = 'Explicit atoms, single/double/triple bonds and formal charges only. No stereochemistry, aromaticity, implicit hydrogens, valence assignment, reaction balancing or chemical safety validation.';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).length !== keys.length || keys.some(key => !(key in result))) throw new Error('Unexpected scientific record fields.');
  return result;
}
function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || [...value].length > maximum || required && !value.trim()) throw new Error(`Text must contain ${required ? '1' : '0'}–${maximum} characters.`);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid scientific identity.');
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error('Invalid scientific integer.');
  return value;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`At most ${maximum} items are supported.`);
  return value;
}
export function parseRecordPin(value: unknown): RecordPin {
  const raw = fields(value, ['id', 'revision']);
  return { id: id(raw.id), revision: integer(raw.revision, 1, 2_147_483_647) };
}
export function parsePlateDesign(value: unknown): PlateDesign {
  const raw = fields(value, ['name', 'description', 'metadata', 'layout', 'origin']);
  const metadata = fields(raw.metadata, ['barcode', 'plateType', 'wellVolumeMicroliters', 'fields']);
  const rawLayout = fields(raw.layout, ['size', 'groups']), size = fields(rawLayout.size, ['rows', 'columns']);
  const layout = createPlate(integer(size.rows, 1, 32), integer(size.columns, 1, 48));
  for (const [well, groups] of Object.entries(object(rawLayout.groups))) {
    const index = plateWellIndex(well, layout.size);
    if (plateWellName(index, layout.size) !== well) throw new Error('Well names must be canonical.');
    const names = list(groups, 12).map(item => text(item, 64, true));
    if (!names.length || new Set(names).size !== names.length) throw new Error('Well groups must be nonempty and distinct.');
    layout.groups[well] = names;
  }
  const custom = list(metadata.fields, 24).map(item => { const field = fields(item, ['key', 'value']); return { key: text(field.key, 64, true), value: text(field.value, 500) }; });
  if (new Set(custom.map(item => item.key.trim().toLowerCase())).size !== custom.length) throw new Error('Metadata field names must be unique.');
  const volume = metadata.wellVolumeMicroliters;
  if (volume !== null && (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0 || volume > 1e6)) throw new Error('Well capacity must be a positive finite volume in µL.');
  return { name: text(raw.name, 200, true), description: text(raw.description, 2000), layout,
    metadata: { barcode: text(metadata.barcode, 200), plateType: text(metadata.plateType, 200), wellVolumeMicroliters: volume as number | null, fields: custom },
    origin: raw.origin === null ? null : parseRecordPin(raw.origin) };
}
export function parseMolecularGraph(value: unknown): MolecularGraph {
  const raw = fields(value, ['atoms', 'bonds']);
  const atoms = list(raw.atoms, 128).map(item => {
    const atom = fields(item, ['id', 'element', 'x', 'y', 'charge']);
    if (!chemicalElements.includes(atom.element as ChemicalElement)) throw new Error('Unsupported element.');
    for (const [key, max] of [['x', 600], ['y', 320]] as const) if (typeof atom[key] !== 'number' || !Number.isFinite(atom[key]) || atom[key] < 0 || atom[key] > max) throw new Error('Atom coordinates lie outside the drawing.');
    return { id: id(atom.id), element: atom.element as ChemicalElement, x: atom.x as number, y: atom.y as number, charge: integer(atom.charge, -3, 3) };
  });
  const identities = new Set(atoms.map(atom => atom.id));
  if (identities.size !== atoms.length) throw new Error('Duplicate atom identity.');
  const pairs = new Set<string>();
  const bonds = list(raw.bonds, 256).map(item => {
    const bond = fields(item, ['id', 'from', 'to', 'order']);
    const from = id(bond.from), to = id(bond.to), pair = [from, to].sort().join(':');
    if (!identities.has(from) || !identities.has(to) || from === to || pairs.has(pair)) throw new Error('Bond endpoints must be distinct existing atoms with one bond per pair.');
    pairs.add(pair);
    return { id: id(bond.id), from, to, order: integer(bond.order, 1, 3) as 1 | 2 | 3 };
  });
  if (new Set(bonds.map(bond => bond.id)).size !== bonds.length) throw new Error('Duplicate bond identity.');
  return { atoms, bonds };
}
export function parseReactionDefinition(value: unknown, submitted = false): ReactionDefinition {
  const raw = fields(value, ['name', 'notes', 'molecules']);
  const molecules = list(raw.molecules, 24).map(item => {
    const molecule = fields(item, ['id', 'name', 'role', 'graph']);
    if (!['reactant', 'product', 'agent'].includes(molecule.role as string)) throw new Error('Invalid molecule role.');
    const graph = parseMolecularGraph(molecule.graph);
    if (submitted && !graph.atoms.length) throw new Error('Draw atoms in every submitted molecule.');
    return { id: id(molecule.id), name: text(molecule.name, 200, submitted), role: molecule.role as ReactionMolecule['role'], graph };
  });
  if (new Set(molecules.map(molecule => molecule.id)).size !== molecules.length) throw new Error('Duplicate molecule identity.');
  if (submitted && (!molecules.some(m => m.role === 'reactant') || !molecules.some(m => m.role === 'product'))) throw new Error('A local reaction record needs at least one reactant and one product.');
  return { name: text(raw.name, 200, submitted), notes: text(raw.notes, 4000), molecules };
}
export function parseReactionRecord(value: unknown): ReactionRecord {
  const raw = fields(value, ['id', 'revision', 'savedAt', 'definition']);
  const savedAt = text(raw.savedAt, 80, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(savedAt) || !Number.isFinite(Date.parse(savedAt)) || savedAt.startsWith('0000-') || new Date(`${savedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== savedAt.slice(0, 10)) throw new Error('Invalid saved record timestamp.');
  return { id: id(raw.id), revision: integer(raw.revision, 1, 2_147_483_647), savedAt, definition: parseReactionDefinition(raw.definition, true) };
}
export function parseChemicalEmbedding(value: unknown): ChemicalEmbedding {
  const raw = fields(value, ['name', 'graph', 'source']);
  let source: ChemicalSource | null = null;
  if (raw.source !== null) {
    const pin = fields(raw.source, ['id', 'revision', 'moleculeId', 'original']);
    source = { ...parseRecordPin({ id: pin.id, revision: pin.revision }), moleculeId: id(pin.moleculeId), original: parseMolecularGraph(pin.original) };
  }
  return { name: text(raw.name, 200), graph: parseMolecularGraph(raw.graph), source };
}
export function isScientificContentAttributes(kind: string, value: unknown): boolean {
  try {
    const attrs = object(value);
    if (kind === 'reactionScheme') { parseReactionDefinition(attrs.reaction); if (attrs.record !== null) parseReactionRecord(attrs.record); return true; }
    if (kind === 'chemical') { parseChemicalEmbedding(attrs.chemical); return true; }
    return false;
  } catch { return false; }
}

/** Core graph transitions preserve identities and never infer missing chemistry. */
export function removeChemicalAtom(graph: MolecularGraph, identity: string): MolecularGraph {
  return { atoms: graph.atoms.filter(atom => atom.id !== identity), bonds: graph.bonds.filter(bond => bond.from !== identity && bond.to !== identity) };
}
export function setChemicalBond(graph: MolecularGraph, from: string, to: string, order: 1 | 2 | 3 | 0, identity: string): MolecularGraph {
  if (from === to || !graph.atoms.some(a => a.id === from) || !graph.atoms.some(a => a.id === to)) throw new Error('Choose two distinct atoms.');
  const existing = graph.bonds.find(bond => bond.from === from && bond.to === to || bond.from === to && bond.to === from);
  const bonds = graph.bonds.filter(bond => bond !== existing);
  if (order !== 0) bonds.push({ id: existing?.id ?? identity, from, to, order });
  return parseMolecularGraph({ ...graph, bonds });
}
function sameMolecularGraph(left: MolecularGraph, right: MolecularGraph): boolean {
  // Compare typed fields, not incidental JSON property order from imported files.
  const signature = (graph: MolecularGraph) => JSON.stringify([
    graph.atoms.map(atom => [atom.id, atom.element, atom.x, atom.y, atom.charge]),
    graph.bonds.map(bond => [bond.id, bond.from, bond.to, bond.order]),
  ]);
  return signature(left) === signature(right);
}
/** The record must come from the local owner lookup, never from the imported document. */
export function chemicalDerivation(chemical: ChemicalEmbedding, localRecord: ReactionRecord | null = null): 'drawn' | 'unverified' | 'extracted' | 'modified' {
  const source = chemical.source;
  if (!source) return 'drawn';
  if (!localRecord || localRecord.id !== source.id || localRecord.revision !== source.revision) return 'unverified';
  const molecule = localRecord.definition.molecules.find(item => item.id === source.moleculeId);
  if (!molecule || !sameMolecularGraph(molecule.graph, source.original)) return 'unverified';
  return sameMolecularGraph(chemical.graph, molecule.graph) ? 'extracted' : 'modified';
}
export function embedReactionMolecule(record: ReactionRecord, moleculeId: string): ChemicalEmbedding {
  const molecule = record.definition.molecules.find(item => item.id === moleculeId);
  if (!molecule) throw new Error('Molecule is no longer in this reaction revision.');
  return { name: molecule.name, graph: structuredClone(molecule.graph), source: { id: record.id, revision: record.revision, moleculeId, original: structuredClone(molecule.graph) } };
}
/** V2000 export includes exactly the explicit graph; no inferred hydrogens or stereo flags. */
export function chemicalMolfile(chemical: ChemicalEmbedding): string {
  const { graph } = chemical;
  const pad = (n: number) => String(n).padStart(3);
  const lines = [chemical.name.replace(/[\r\n]/g, ' ').slice(0, 80), '  Pero local graph', 'Explicit graph only; no stereochemistry validation', `${pad(graph.atoms.length)}${pad(graph.bonds.length)}  0  0  0  0            999 V2000`];
  for (const atom of graph.atoms) lines.push(`${(atom.x / 40).toFixed(4).padStart(10)}${(-atom.y / 40).toFixed(4).padStart(10)}    0.0000 ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  for (const bond of graph.bonds) lines.push(`${pad(graph.atoms.findIndex(a => a.id === bond.from) + 1)}${pad(graph.atoms.findIndex(a => a.id === bond.to) + 1)}${pad(bond.order)}  0  0  0  0`);
  const charged = graph.atoms.flatMap((atom, index) => atom.charge ? [{ index: index + 1, charge: atom.charge }] : []);
  for (let offset = 0; offset < charged.length; offset += 8) { const part = charged.slice(offset, offset + 8); lines.push(`M  CHG${pad(part.length)}${part.map(atom => ` ${pad(atom.index)} ${pad(atom.charge)}`).join('')}`); }
  return [...lines, 'M  END', ''].join('\n');
}
export function exportChemical(chemical: ChemicalEmbedding): string { return JSON.stringify({ format: 'pero-chemical/1', chemical }, null, 2); }
export function importChemical(json: string): ChemicalEmbedding {
  if (new TextEncoder().encode(json).length > 262144) throw new Error('Chemical JSON exceeds 256 KiB.');
  const raw = fields(JSON.parse(json), ['format', 'chemical']);
  if (raw.format !== 'pero-chemical/1') throw new Error('Unsupported chemical JSON format.');
  return parseChemicalEmbedding(raw.chemical);
}
