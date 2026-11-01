import type { Experiment } from './types';

/** The approval reference is domain evidence, never a snapshot of UI progress. */
export function labReferenceState(experiment: Pick<Experiment, 'id' | 'spec_hash' | 'trials'> | null) {
  return {
    experimentId: experiment?.id ?? null,
    specHash: experiment?.spec_hash ?? null,
    trials: experiment?.trials.map(item => ({ id: item.id, status: item.status,
      parent_trial_id: item.parent_trial_id, reason: item.reason, verification: item.verification })) ?? [],
  };
}
