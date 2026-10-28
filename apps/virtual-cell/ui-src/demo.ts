import type { Mechanism, Volume } from './science';

export const mechanismExample: Mechanism = {
  schema: 'point.virtual-cell.mechanism.v1',
  source: { id: 'A ⇄ B → C', revision: 'teaching-v1', kind: 'illustrative' },
  timeUnit: 's', concentrationUnit: 'a.u.', duration: 20,
  species: [{ id: 'A', initial: 10 }, { id: 'B', initial: 0 }, { id: 'C', initial: 0 }],
  reactions: [{ id: 'r1', from: 'A', to: 'B', rate: .35 }, { id: 'r2', from: 'B', to: 'A', rate: .12 }, { id: 'r3', from: 'B', to: 'C', rate: .18 }],
};

/** Analytic voxel phantom, independent of any transcriptomics dataset. */
export function volumeExample(): Volume {
  const n = 64, channels = ['membrane', 'nucleus', 'organelles'].map(name => ({ name, values: [] as number[] }));
  // Keep the generated teaching fixture exportable within the 16 MiB import
  // budget. Six significant digits exceed the half-float display precision.
  const sample = (value: number) => Number(value.toPrecision(6));
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // Sample voxel centres, matching normalized 3D texture coordinates.
    const a = ((x + .5) / n - .5) * 2.4, b = ((y + .5) / n - .5) * 2.4, c = ((z + .5) / n - .5) * 2.4;
    const r = Math.sqrt(a * a + b * b / .64 + c * c / .81);
    channels[0].values.push(sample(Math.exp(-(((r - 1) / .045) ** 2)) * .6));
    channels[1].values.push(sample(Math.exp(-(((Math.sqrt((a + .14) ** 2 + b * b + c * c) - .4) / .045) ** 2))));
    let organelle = 0;
    for (let j = 0; j < 9; j++) {
      const angle = j * 2.399, dx = a - .62 * Math.cos(angle), dy = b - .5 * Math.sin(angle), dz = c - .35 * Math.sin(j * 1.6);
      organelle = Math.max(organelle, Math.exp(-(dx * dx / .025 + dy * dy / .008 + dz * dz / .012)));
    }
    channels[2].values.push(sample(organelle));
  }
  return { schema: 'point.virtual-cell.volume.v1', source: { id: 'analytic-cell-phantom', revision: 'v2', kind: 'illustrative' }, dimensions: [n, n, n], spacing: [12 / n, 12 / n, 12 / n], unit: 'µm', channels };
}
