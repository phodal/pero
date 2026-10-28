/* Browser counterpart of Virtual Cell's three empirical baselines.
 * The build embeds the App's synthetic fixture; no model or dataset download.
 * Predictions use train conditions only. Test readouts are used for scoring.
 * This inspectable browser example is non-blind and has no execution isolation.
 */
(function (root) {
  'use strict';
  const fixture = __CELL_FIXTURE__;
  const methods = Object.freeze(['control', 'train_mean', 'additive']);
  const data = fixture.dataset;
  const byId = new Map(data.conditions.map(row => [row.id, row]));
  const control = byId.get(data.control).mean;
  const train = fixture.split.assignments.train.map(id => byId.get(id));
  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  class PerturbationBenchmark {
    constructor(method) {
      if (!methods.includes(method)) throw new RangeError('Unknown baseline: ' + method);
      this.method = method;
      Object.freeze(this);
    }
    run() {
      const rows = fixture.split.assignments.test.map(id => {
        const condition = byId.get(id);
        const additive = control.map((c, g) => condition.targets.reduce((sum, target) => sum + byId.get(target).mean[g] - c, c));
        const prediction = this.method === 'control' ? control.slice() : this.method === 'additive' ? additive : control.map((_, g) => train.reduce((sum, row) => sum + row.mean[g], 0) / train.length);
        const observed = condition.mean.map((v, g) => v - control[g]);
        const predicted = prediction.map((v, g) => v - control[g]);
        const squaredError = predicted.map((v, g) => (v - observed[g]) ** 2);
        const deltaMse = squaredError.reduce((a, b) => a + b, 0) / data.genes.length;
        const referenceMse = additive.reduce((sum, v, g) => sum + (v - control[g] - observed[g]) ** 2, 0) / data.genes.length;
        return { id, observed, predicted, squaredError, deltaMse, referenceMse, skill: referenceMse === 0 ? null : 1 - deltaMse / referenceMse };
      });
      const skillRows = rows.filter(row => row.skill !== null);
      return {
        method: this.method, methodVersion: 'virtual-cell.baselines.v1', evaluatorVersion: 'openpero.browser-perturbation.v1',
        dataVersion: data.source.id + '/' + data.source.revision, genes: data.genes.slice(), scale: data.scale,
        splitDigest: fixture.split.digest, rows, medianDeltaMse: median(rows.map(row => row.deltaMse)),
        medianSkill: skillRows.length ? median(skillRows.map(row => row.skill)) : null,
        skillDenominator: skillRows.length, skillExcluded: rows.filter(row => row.skill === null).map(row => ({ id: row.id, reason: 'additive_exact' })),
        denominator: { attempted: rows.length, evaluated: rows.length, failed: 0 },
        scope: { kind: 'synthetic-demonstration', blind: false, isolation: 'unverified', scientificAcceptance: false }
      };
    }
  }
  root.OpenPeroExperiment = Object.freeze({
    run: options => new PerturbationBenchmark(options?.method || 'additive').run(), methods,
    presets: Object.freeze({ baseline: Object.freeze({ method: 'control' }), variant: Object.freeze({ method: 'additive' }) }),
    // Return copies so UI/export code cannot mutate the shared input.
    inputs: () => JSON.parse(JSON.stringify(fixture))
  });
})(typeof window !== 'undefined' ? window : globalThis);
