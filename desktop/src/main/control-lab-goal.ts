import { isDeepStrictEqual } from 'node:util';
import type { ContextReference } from '../../../protocol/generated/host';
import { AppUseError, type AppScope } from './app-use-task.ts';

export type ControlLabGoal = Readonly<{ experimentId: string; specHash: string; maxExperiments: 1 }>;
type Pending = { reference: ContextReference; goal: ControlLabGoal };

/** A goal is approved in the selected draft and takes effect only when that exact reference is sent. */
export class ControlLabGoals {
  private pending = new Map<string, Pending>();
  private bound = new Map<string, ControlLabGoal>();
  private identities = new Map<string, ControlLabGoal>();
  private restored = new Set<string>();

  approve(scope: AppScope, thread: string, references: ContextReference[]) {
    if (this.restored.has(thread)) throw new AppUseError('APP_GOAL_RESTORED', 'Start a new conversation to approve a goal.');
    if (scope.app !== 'control-lab' || scope.panel !== 'main' || references.length !== 1)
      throw new AppUseError('APP_GOAL_INVALID', 'Approve one Control Lab experiment.');
    const reference = references[0];
    if (reference.kind !== 'app_object' || reference.content.type !== 'text')
      throw new AppUseError('APP_GOAL_INVALID', 'The frozen experiment reference is required.');
    const snapshot = JSON.parse(reference.content.text);
    const state = snapshot?.state;
    if (snapshot?.schema !== 'pero.app-object.v1' || snapshot?.scope?.app !== scope.app ||
        snapshot?.scope?.panel !== scope.panel || snapshot?.objectId !== 'control-lab' ||
        !/^[a-f0-9]{32}$/.test(state?.experimentId || '') || !/^[a-f0-9]{64}$/.test(state?.specHash || ''))
      throw new AppUseError('APP_GOAL_INVALID', 'Freeze an experiment before approving its goal.');
    const goal: ControlLabGoal = Object.freeze({ experimentId: state.experimentId, specHash: state.specHash, maxExperiments: 1 });
    const current = this.identities.get(thread);
    if (current && !isDeepStrictEqual(current, goal))
      throw new AppUseError('APP_GOAL_FIXED', 'Start a new conversation to approve a different goal.');
    this.pending.set(thread, { reference: structuredClone(reference), goal });
  }

  accept(thread: string, references: readonly ContextReference[], idle = true) {
    const pending = this.pending.get(thread);
    if (!pending) return;
    this.pending.delete(thread);
    if (!idle) return;
    const matching = references.filter(reference => reference.id === pending.reference.id);
    if (matching.length !== 1 || !isDeepStrictEqual(matching[0], pending.reference)) return;
    const existing = this.bound.get(thread);
    if (!existing || isDeepStrictEqual(existing, pending.goal)) {
      this.identities.set(thread, pending.goal);
      this.bound.set(thread, pending.goal);
    }
  }

  require(thread: string, experimentId: unknown): ControlLabGoal {
    const goal = this.bound.get(thread);
    if (!goal || experimentId !== goal.experimentId)
      throw new AppUseError('APP_GOAL_DENIED', 'Approve and submit this frozen experiment in this conversation first.');
    return goal;
  }
  has(thread: string) { return this.identities.has(thread) || this.pending.has(thread); }
  revoke(thread: string) { this.pending.delete(thread); this.bound.delete(thread); }
  revokeAll() { this.pending.clear(); this.bound.clear(); }
  blockRestored(thread: string) { this.revoke(thread); this.restored.add(thread); }

  forget(thread?: string) {
    if (thread) { this.revoke(thread); this.identities.delete(thread); this.restored.delete(thread); }
    else { this.pending.clear(); this.bound.clear(); this.identities.clear(); this.restored.clear(); }
  }
}
