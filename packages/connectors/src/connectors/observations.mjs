import { configurationState } from './model.mjs';

const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const revision = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
const label = value => typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} ._@()+-]{0,159}$/u.test(value);

/** Owner observations only: no configuration, accounts, URLs, credentials,
 * tool admission or OAuth attempts. This covers this ConnectorManager, not
 * Agent Plugin declarations or other Agent-owned MCP execution sessions. */
export function unavailableConnectorObservations(code = 'native-connector-owner-unavailable', availability = 'unavailable') {
  return { schemaVersion: 1, coverage: 'native-connector-manager', availability, complete: false, diagnostics: [code], entries: [] };
}

/** The caller supplies facts from the existing owner, already reconciled to
 * each stored revision. `verified` is historical last-probe evidence, never
 * proof of current connectivity or permission to execute. */
export function projectConnectorObservations(records) {
  const result = { schemaVersion: 1, coverage: 'native-connector-manager', availability: 'available', complete: true, diagnostics: [], entries: [] };
  const partial = code => { result.complete = false; if (!result.diagnostics.includes(code)) result.diagnostics.push(code); };
  for (const { provider, facts, unavailable = false } of records) {
    const connection = facts.connection;
    if (!identifier(connection.connectionId) || !identifier(connection.providerId)) { partial('native-connector-label-omitted'); continue; }
    const configRevision = revision(connection.revision) ? connection.revision : null;
    if (!configRevision) partial('native-connector-revision-unknown');
    const runtime = facts.runtime ?? {}, probe = runtime.lastProbe ?? {};
    const uncertainMutation = facts.lastMutation?.runtimeTouched && !facts.lastMutation?.runtimeApplied;
    const uncertainCleanup = ['unknown', 'pending'].includes(runtime.cleanup);
    let connected = null, verified = null, probedAt = null;
    if (!unavailable && configRevision && !uncertainMutation && !uncertainCleanup) {
      if (runtime.phase === 'ready' && runtime.holdsLease === true) connected = true;
      else if (['stopped', 'retired', 'start-failed'].includes(runtime.phase) && runtime.holdsLease !== true) connected = false;
      if (Number.isSafeInteger(probe.atMs) && probe.atMs >= 0 && probe.atMs <= 8640000000000000 && ['verified', 'failed'].includes(probe.outcome)) {
        verified = probe.outcome === 'verified';
        probedAt = new Date(probe.atMs).toISOString();
      }
    }
    if (unavailable) partial('native-connector-provider-unavailable');
    if (uncertainMutation) partial('native-connector-runtime-uncertain');
    if (uncertainCleanup) partial('native-connector-cleanup-uncertain');
    result.entries.push({
      id: connection.connectionId, providerId: connection.providerId,
      displayName: label(provider?.displayName) ? provider.displayName : connection.connectionId,
      configurationRevision: configRevision, configured: true,
      configurationComplete: provider ? configurationState(connection, provider).complete : null,
      enabled: connection.enabled === true, loaded: null, connected, verified,
      verificationKind: 'last-probe', probedAt,
    });
  }
  result.entries.sort((left, right) => left.id.localeCompare(right.id));
  return result;
}
