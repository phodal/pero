import type { SanitizedSequence } from './science-sequence.ts';
export interface MeltingConditions { method: 'santalucia' | 'breslauer' | 'xia'; oligoNm: number; sodiumMm: number; magnesiumMm: number; dntpMm: number }
type Pair = readonly [number, number];
// Published nearest-neighbor ΔH (kcal/mol), ΔS (cal/mol/K), in AA,AT,TA,CA,GT,CT,GA,CG,GC,GG order.
const parameters: Record<MeltingConditions['method'], readonly Pair[]> = {
  santalucia: [[-7.9, -22.2], [-7.2, -20.4], [-7.2, -21.3], [-8.5, -22.7], [-8.4, -22.4], [-7.8, -21], [-8.2, -22.2], [-10.6, -27.2], [-9.8, -24.4], [-8, -19.9]],
  breslauer: [[-9.1, -24], [-8.6, -23.9], [-6, -16.9], [-5.8, -12.9], [-6.5, -17.3], [-7.8, -20.8], [-5.6, -13.5], [-11.9, -27.8], [-11.1, -26.7], [-11, -26.6]],
  xia: [[-6.82, -19], [-9.38, -26.7], [-7.69, -20.5], [-10.44, -26.9], [-11.4, -29.5], [-10.48, -27.1], [-12.44, -32.5], [-10.64, -26.7], [-14.88, -36.9], [-13.39, -32.7]],
};
const keys = ['AA', 'AT', 'TA', 'CA', 'GT', 'CT', 'GA', 'CG', 'GC', 'GG'];
const reversePair: Record<string, string> = { TT: 'AA', TG: 'CA', AC: 'GT', AG: 'CT', TC: 'GA', CC: 'GG' };

export function estimateMeltingTemperature(sequence: SanitizedSequence, conditions: MeltingConditions) {
  const { method, oligoNm, sodiumMm, magnesiumMm, dntpMm } = conditions;
  if (!parameters[method]) throw new Error('Unsupported melting-temperature method.');
  if ([oligoNm, sodiumMm, magnesiumMm, dntpMm].some(v => !Number.isFinite(v)) || oligoNm <= 0 || sodiumMm <= 0 || magnesiumMm < 0 || dntpMm < 0) throw new Error('Oligo and sodium must be positive; magnesium and dNTP must be non-negative finite concentrations.');
  if (oligoNm > 1e9 || sodiumMm > 1e4 || magnesiumMm > 1e4 || dntpMm > 1e4) throw new Error('Concentrations exceed the supported range (oligo 1 M; others 10 M).');
  if ((sequence.alphabet === 'RNA') !== (method === 'xia')) throw new Error('Use Xia for RNA and a DNA method for DNA.');
  const dna = sequence.bases.replaceAll('U', 'T');
  if (!/^[ACGT]{2,}$/.test(dna)) throw new Error('Tm requires at least two unambiguous nucleotides.');
  if (method === 'xia' && (magnesiumMm !== 0 || dntpMm !== 0)) throw new Error('Xia supports sodium only; set magnesium and dNTP to zero.');
  const sodiumEquivalent = sodiumMm + (method === 'xia' ? 0 : 120 * Math.sqrt(Math.max(0, magnesiumMm - dntpMm)));
  if (dna.length > 80 && method === 'santalucia') {
    const gc = [...dna].filter(b => b === 'G' || b === 'C').length * 100 / dna.length;
    return { method: 'pero-long-dna/1', celsius: 81.5 + 16.6 * Math.log10(sodiumEquivalent / 1000) + 0.41 * gc - 600 / dna.length,
      conditions, sodiumEquivalentMm: sodiumEquivalent, notes: 'Long-DNA empirical estimate (>80 nt): 81.5 + 16.6 log10([Na]eq M) + 0.41 GC% − 600/N. Oligo concentration does not enter this approximation.' };
  }
  let h = method === 'xia' ? 3.61 : 0;
  let s = method === 'xia' ? -1.5 : method === 'santalucia' ? 0 : /[GC]/.test(dna) ? -16.8 : -20.1;
  if (method !== 'breslauer') for (const base of [dna[0], dna.at(-1)]) {
    const at = base === 'A' || base === 'T';
    h += method === 'xia' ? (at ? 3.72 : 0) : (at ? 2.3 : 0.1);
    s += method === 'xia' ? (at ? 10.5 : 0) : (at ? 4.1 : -2.8);
  }
  for (let i = 0; i < dna.length - 1; i++) {
    const pair = dna.slice(i, i + 2), values = parameters[method][keys.indexOf(reversePair[pair] ?? pair)];
    h += values[0]; s += values[1];
  }
  const complement: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  const symmetric = dna === [...dna].reverse().map(b => complement[b]).join('');
  if (symmetric) s -= method === 'breslauer' ? 1.3 : 1.4;
  s += 0.368 * (dna.length - 1) * Math.log(sodiumEquivalent / 1000);
  const celsius = h * 1000 / (s + 1.987 * Math.log(oligoNm * 1e-9 / (symmetric ? 1 : 4))) - 273.15;
  if (!Number.isFinite(celsius) || celsius <= -273.15) throw new Error('These conditions produce an invalid thermodynamic estimate.');
  return { method: `pero-${method}-nn/1`, celsius, conditions, sodiumEquivalentMm: sodiumEquivalent,
    notes: 'Perfect duplex nearest-neighbor estimate using SantaLucia 1998 / Breslauer 1986 / Xia 1998 published parameters. Entropy salt correction 0.368(N−1)ln([Na]eq M). DNA sodium equivalent mM = Na + 120√max(Mg−dNTP,0). Total strand concentration uses divisor 4 (1 for self-complementary). This declared approximation is not Primer3, the recovered legacy algorithm, a measurement, or owner verification.' };
}
