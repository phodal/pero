/** App-local comparison receipts. The backend owns every run transition. */
export type ComparisonStatus = 'starting' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type ComparisonRun = {
  id: string; inputId: string; status: ComparisonStatus;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  outputId: string | null; error: string | null;
  process: { pid: number | null; exitCode: number | null; exitObserved: boolean; terminationRequested: string | null };
  methods: { id: string; version: string }[]; evaluator: string;
  scope: string; isolation: string; acceptance: string;
};
export type ComparisonDetail = ComparisonRun & {
  logs: string; logsTruncated: boolean;
  sourceHashes: Record<string, string>; environment: Record<string, string>;
};
export type ConditionResult = {
  id: string; status: string; reason?: string;
  delta_mse?: number; delta_pearson?: number | null; skill_vs_reference?: number;
  support: {
    readouts: { status: string; targets_present: number; targets_expected: number; targets_missing: string[]; endpoints_missing: string[] };
    design: { status: string; reasons: string[] };
  };
};
export type ModelResult = {
  model: { id: string; version: string }; metric_status: string;
  denominator: { attempted: number; evaluated: number; failed: number };
  coverage: { attempted: number; target_readouts_complete: number; batch_matched: number };
  delta_mse: { median: number | null };
  skill_vs_reference: { median: number | null; n: number; excluded: { id: string; reason: string }[] };
  conditions: ConditionResult[];
};
export type ComparisonOutput = {
  inputId: string; operation: 'compare';
  result: {
    models: ModelResult[]; dataset_digest: string; spec_digest: string; split_digest: string;
    denominators: Record<string, unknown>;
  };
};
export type ComparisonInput = {
  dataset: { source: { id: string; revision: string }; genes: string[]; conditions: unknown[]; scale: string; control: string };
  spec: { dataset: { digest: string } };
  split: { digest: string; spec_digest: string; counts: Record<string, number>; excluded: { id: string; reason: string }[] };
};

export type DatasetStatus = 'idle' | 'cached' | 'downloading' | 'verifying' | 'cancelling' | 'cancelled' | 'failed' | 'interrupted' | 'ready';
export type DatasetDownload = {
  source: {
    id: string; revision: string; filename: string; record: string; downloadUrl: string;
    bytes: number; md5: string; sha256: string; sha256Evidence: string;
    license: { id: string; url: string }; warning: string;
  };
  status: DatasetStatus; receivedBytes: number; verifiedBytes: number; expectedBytes: number;
  attempt: number; startedAt: string | null; finishedAt: string | null; error: string | null;
  path: string; partialPath: string; prepared: false; verificationRequired: boolean;
  checksums: { md5: string; sha256: string } | null; transferStopped: boolean;
};

/** An available button is not an effect: downloads always require a click. */
export function datasetAction(status: DatasetStatus): 'download' | 'verify' | 'retry' | null {
  if (status === 'idle') return 'download';
  if (status === 'cached') return 'verify';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'retry';
  return null;
}

export function datasetActive(status: DatasetStatus): boolean {
  return status === 'downloading' || status === 'verifying' || status === 'cancelling';
}

export function comparisonActive(status: ComparisonStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'cancelling';
}

/** Keep each attempted condition, including failures and skill exclusions. */
export function conditionRows(models: ModelResult[], search: string, method: string) {
  const query = search.trim().toLowerCase();
  return models.filter(model => !method || model.model.id === method).flatMap(model => {
    const exclusions = new Map(model.skill_vs_reference.excluded.map(row => [row.id, row.reason]));
    return model.conditions.filter(row => row.id.toLowerCase().includes(query)).map(row => ({
      method: model.model.id, ...row,
      reasons: [row.reason, exclusions.get(row.id),
        ...row.support.design.reasons,
        ...row.support.readouts.targets_missing.map(gene => `target_readout_missing: ${gene}`),
        ...row.support.readouts.endpoints_missing.map(gene => `endpoint_readout_missing: ${gene}`),
      ].filter((reason): reason is string => !!reason),
    }));
  });
}
