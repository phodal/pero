export type ChemistryVariable = 'mass' | 'amount' | 'volume' | 'equivalence' | 'formulaWeight' | 'purity' | 'molarity' | 'density' | 'limitingAmount' | 'limitingEquivalence';
export type ChemistryTarget = 'mass' | 'amount' | 'volume' | 'equivalence';
export interface ChemistryField { text: string; unit: string }
export interface ChemistryInput { target: ChemistryTarget; significantFigures: number; fields: Record<ChemistryVariable, ChemistryField> }
export const chemistryUnits: Record<ChemistryVariable, Readonly<Record<string, number>>> = {
  mass: { g: 1, mg: 1e-3, 'µg': 1e-6 }, amount: { mol: 1, mmol: 1e-3, 'µmol': 1e-6 },
  volume: { L: 1, mL: 1e-3, 'µL': 1e-6 }, equivalence: { eq: 1 }, formulaWeight: { 'g/mol': 1 },
  purity: { fraction: 1, '%': 0.01 }, molarity: { M: 1, mM: 1e-3, 'µM': 1e-6 },
  density: { 'g/L': 1, 'g/mL': 1000 }, limitingAmount: { mol: 1, mmol: 1e-3, 'µmol': 1e-6 }, limitingEquivalence: { eq: 1 },
};
interface Relation { name: string; factors: Partial<Record<ChemistryVariable, number>> }
// Product of factors raised to these powers equals one. Values use g, mol and L.
const relations: Relation[] = [
  { name: 'n = mass × purity / formula weight', factors: { amount: 1, mass: -1, purity: -1, formulaWeight: 1 } },
  { name: 'n = volume × molarity', factors: { amount: 1, volume: -1, molarity: -1 } },
  { name: 'mass = volume × density', factors: { mass: 1, volume: -1, density: -1 } },
  { name: 'equivalents = n × limiting equivalents / limiting amount', factors: { equivalence: 1, amount: -1, limitingEquivalence: -1, limitingAmount: 1 } },
];
export type ChemistryResult =
  | { status: 'missing'; alternatives: string[] }
  | { status: 'solved'; method: 'pero-dimensional-chemistry/1'; input: ChemistryInput; value: number; formatted: string; unit: string; derivations: string[]; normalized: Partial<Record<ChemistryVariable, number>>; limits: string };

/** Boundary parser and solver. No silently inferred purity or limiting-reagent assumptions. */
export function solveChemistry(input: ChemistryInput): ChemistryResult {
  if (!['mass', 'amount', 'volume', 'equivalence'].includes(input.target)) throw new Error('Unsupported solve target.');
  if (!Number.isInteger(input.significantFigures) || input.significantFigures < 1 || input.significantFigures > 12) throw new Error('Significant figures must be between 1 and 12.');
  const values: Partial<Record<ChemistryVariable, number>> = {}, derivations: string[] = [];
  for (const variable of Object.keys(chemistryUnits) as ChemistryVariable[]) {
    const field = input.fields[variable], factor = chemistryUnits[variable][field?.unit];
    if (factor === undefined) throw new Error(`Unsupported ${variable} unit.`);
    if (variable === input.target || !field.text.trim()) continue;
    if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(field.text.trim())) throw new Error(`Invalid positive decimal for ${variable}.`);
    const value = Number(field.text) * factor;
    if (!Number.isFinite(value) || value <= 0 || (variable === 'purity' && value > 1)) throw new Error(`${variable} must be positive and finite; purity must not exceed 100%.`);
    values[variable] = value;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      const entries = Object.entries(relation.factors) as [ChemistryVariable, number][];
      const missing = entries.filter(([variable]) => values[variable] === undefined);
      if (missing.length > 1) continue;
      const sum = entries.reduce((s, [v, power]) => s + (values[v] === undefined ? 0 : power * Math.log(values[v]!)), 0);
      if (!missing.length) {
        if (Math.abs(sum) > 1e-6) throw new Error(`Conflicting supplied quantities: ${relation.name}.`);
      } else {
        const [variable, power] = missing[0], value = Math.exp(-sum / power);
        if (!Number.isFinite(value) || value <= 0 || (variable === 'purity' && value > 1 + 1e-9)) throw new Error(`Invalid inferred ${variable}; check units and inputs.`);
        values[variable] = value; derivations.push(`${variable}: ${relation.name}`); changed = true;
      }
    }
  }
  if (values[input.target] === undefined) return { status: 'missing', alternatives: relations.map(r => `${r.name}; missing: ${Object.keys(r.factors).filter(v => values[v as ChemistryVariable] === undefined).join(', ')}`) };
  const unit = input.fields[input.target].unit, value = values[input.target]! / chemistryUnits[input.target][unit];
  if (!Number.isFinite(value) || value <= 0) throw new Error('The output cannot be represented in the selected unit.');
  return { status: 'solved', method: 'pero-dimensional-chemistry/1', input, value, formatted: value.toPrecision(input.significantFigures), unit, derivations, normalized: values,
    limits: 'IEEE-754 floating-point math, not arbitrary precision. Positive quantities only; blank means unknown. Target input is ignored. Purity applies only to the mass/formula-weight relation, not to a supplied solution molarity. All complete relationships must agree to log-ratio tolerance 1e-6. This computes quantities, not reaction feasibility, limiting-reagent identity, physical execution or owner verification.' };
}
