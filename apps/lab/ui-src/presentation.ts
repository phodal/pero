import type { LabState, Protocol } from './types';

export function exampleProtocol(redVolume = 50, revision = 0): Protocol {
  return { version: 1, initial_revision: revision, steps: [
    { op: 'pickup_tip', resource: 'T1' },
    { op: 'aspirate', resource: 'A1', volume_ul: redVolume },
    { op: 'dispense', resource: 'B1', volume_ul: redVolume },
    { op: 'return_tip', resource: 'T1' },
    { op: 'pickup_tip', resource: 'T2' },
    { op: 'aspirate', resource: 'A2', volume_ul: 100 - redVolume },
    { op: 'dispense', resource: 'B1', volume_ul: 100 - redVolume },
    { op: 'return_tip', resource: 'T2' },
  ] };
}
export function stateDelta(before: LabState, after: LabState | null): string {
  if (!after) return 'No committed after-state';
  const changed = after.wells.flatMap(well => {
    const prior = before.wells.find(item => item.id === well.id);
    return prior && prior.volume_ul !== well.volume_ul ? [`${well.id}: ${prior.volume_ul} → ${well.volume_ul} µL`] : [];
  });
  if (before.pipette.volume_ul !== after.pipette.volume_ul) changed.push(`Pipette: ${before.pipette.volume_ul} → ${after.pipette.volume_ul} µL`);
  if (before.pipette.tip_id !== after.pipette.tip_id) changed.push(`Tip: ${before.pipette.tip_id ?? 'none'} → ${after.pipette.tip_id ?? 'none'}`);
  return changed.join('; ') || 'No liquid or tip change';
}
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export const formatNumber = (value: number | null | undefined): string => value == null ? '—' : Number(value.toFixed(4)).toString();

export const checkLabel = (name: string): string => ({
  execution: 'Execution', target_volume_ul: 'Target volume', observed_fraction: 'Observed fraction',
}[name] ?? name.replaceAll('_', ' '));
export function trialLabel(trials: { id: string; parent_trial_id: string | null }[], id: string): string {
  const index = trials.findIndex(trial => trial.id === id);
  if (index < 0) return 'Unknown trial';
  return `Trial ${index + 1} · ${trials[index].parent_trial_id ? 'Revision' : 'Baseline'}`;
}
