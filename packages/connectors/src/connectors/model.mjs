// The pure connector domain ported from Point.
//
// A connector is a directory entry, an authorization, a runtime and a tool
// policy: four facts written by four different authorities. A card is a pure
// projection of them, which is why deriveConnectionView is a function nobody
// writes to. This module imports nothing: it runs unchanged in the Electron
// main process and inside the sandboxed settings renderer.

export const CARD_STATES = ['needs-configuration', 'disabled', 'not-connected', 'waiting-for-approval', 'connecting', 'needs-authorization', 'verified', 'connected', 'not-verified', 'needs-attention'];
export const REASONS = ['configuration-incomplete', 'disabled-by-user', 'never-connected', 'awaiting-consent', 'runtime-starting', 'grant-absent', 'grant-expired', 'grant-rejected', 'grant-indeterminate', 'install-failed', 'start-failed', 'probe-failed', 'probe-cancelled', 'partial-mutation', 'runtime-live', 'probe-verified', 'grant-present-unverified', 'provider-unavailable'];
export const ACTIONS = ['configure', 'connect', 'reauthorize', 'cancel-attempt', 'verify', 'retry', 'enable', 'disable', 'disconnect-runtime', 'logout', 'remove', 'revoke-at-provider', 'open-docs'];
export const BADGES = ['source-builtin', 'auth-required', 'no-auth', 'lease-held', 'probe-released', 'grant-unknown', 'scope-limited', 'approval-required', 'multi-account', 'partial-mutation'];
export const BLOCK_REASONS = ['not-discovered', 'not-host-allowed', 'out-of-grant-scope', 'user-disabled', 'policy-blocked'];
export const NEXT_STEPS = ['none', 'refresh', 'restart-runtime', 'reauthorize', 'retry-operation', 'manual'];
export const LIFECYCLE = ['disable', 'enable', 'disconnect-runtime', 'logout', 'remove', 'revoke-at-provider'];
export const EFFECT_ORDER = ['read', 'write', 'delete', 'share', 'external_send'];
export const ATTEMPT_TTL_MS = 120000;
export const ATTEMPT_POLL_INTERVAL_MS = 500;
export const TERMINAL_ATTEMPT_STATES = new Set(['succeeded', 'cancelled', 'expired', 'failed']);

const list = value => (Array.isArray(value) ? value : []);
const has = (values, name) => list(values).includes(name);

/** Missing requirements are a joining precondition, never a failed login. */
export function configurationState(connection, provider) {
  const supplied = new Set(list(connection?.supplied));
  const missing = list(provider?.requires).filter(requirement => requirement.required && !supplied.has(requirement.key)).map(requirement => requirement.key).sort();
  return { complete: !missing.length, missing };
}

/** Only a user grant can be logged into; a token is configured, not signed into. */
export const requiresAuthorization = provider => ['user-oauth', 'user-qr'].includes(provider?.auth?.mode);

const grantExpired = (authorization, now) => Number.isFinite(authorization?.expiresAtMs) && now >= authorization.expiresAtMs;
const grantUsable = (authorization, now) => authorization?.grant === 'present' && !authorization.failure && !grantExpired(authorization, now);

/**
 * discovered ∩ hostAllowed ∩ grant scope ∩ user and organization policy. The
 * universe is discovered ∪ hostAllowed, so a configured-but-missing tool is
 * reported as not-discovered instead of silently disappearing. A server's own
 * descriptions and annotations rank and explain; they never add a name here.
 */
export function resolveToolPolicy(policy = {}) {
  const discovered = new Set(list(policy.discovered));
  const hostAllowed = new Set(list(policy.hostAllowed));
  // null means the grant does not constrain tools; [] means it covers nothing.
  const grantScoped = policy.grantScoped == null ? null : new Set(policy.grantScoped);
  const usable = [], blocked = [], needsApproval = [];
  for (const name of [...new Set([...discovered, ...hostAllowed])].sort()) {
    if (!discovered.has(name)) blocked.push({ name, reason: 'not-discovered' });
    // The allowlist is always a constraint. An empty one admits nothing; it
    // never means "unconstrained", or a connection saved before discovery
    // would silently admit everything the server offers.
    else if (!hostAllowed.has(name)) blocked.push({ name, reason: 'not-host-allowed' });
    else if (grantScoped && !grantScoped.has(name)) blocked.push({ name, reason: 'out-of-grant-scope' });
    else if (has(policy.blocked, name)) blocked.push({ name, reason: 'policy-blocked' });
    else if (has(policy.userDisabled, name)) blocked.push({ name, reason: 'user-disabled' });
    else {
      usable.push(name);
      if (has(policy.needsApproval, name)) needsApproval.push(name);
    }
  }
  return { usable, blocked, needsApproval };
}

/** Recommended scopes a grant does not carry: an explanation, not a logout. */
export function scopeShortfall(provider, authorization) {
  if (authorization?.grant !== 'present') return [];
  const granted = new Set(list(authorization.scopes));
  return list(provider?.auth?.recommendedScopes).filter(scope => !granted.has(scope)).sort();
}

const runtimeSettled = outcome => !outcome.runtimeTouched || outcome.runtimeApplied;

/** Every facet the operation actually touches landed. */
export function mutationSucceeded(outcome) {
  switch (outcome?.operation) {
    case 'disconnect-runtime': return !!outcome.runtimeApplied;
    case 'logout': return !!outcome.authorizationApplied && runtimeSettled(outcome);
    case 'remove': return !!outcome.configurationApplied && !!outcome.authorizationApplied && runtimeSettled(outcome);
    case 'revoke-at-provider': return !outcome.code;
    default: return !!outcome?.configurationApplied && runtimeSettled(outcome ?? {});
  }
}

/**
 * The smallest correct recovery for a partially applied change. A stored
 * configuration that already landed is never re-applied, and a grant that is
 * still intact never triggers a login.
 */
export function nextStep(outcome) {
  if (!outcome) return 'none';
  if (mutationSucceeded(outcome)) return ['remove', 'revoke-at-provider'].includes(outcome.operation) ? 'refresh' : 'none';
  switch (outcome.operation) {
    case 'enable': case 'disable': case 'configure':
      return outcome.configurationApplied ? 'restart-runtime' : 'retry-operation';
    case 'disconnect-runtime': return 'manual';
    // The record is gone locally but a session minted from it is still live.
    case 'logout': return outcome.authorizationApplied ? 'restart-runtime' : 'retry-operation';
    // The configuration is gone, so there is nothing left to retry against.
    case 'remove': return outcome.configurationApplied && !outcome.authorizationApplied ? 'manual' : 'retry-operation';
    default: return 'retry-operation';
  }
}

/**
 * Computed from facts rather than hard-coded per state, so a sealed connection
 * never grows a delete button and a token provider never grows a logout.
 */
export function offeredLifecycle(provider, facts) {
  const offered = [facts.connection?.enabled ? 'disable' : 'enable'];
  if (facts.runtime?.holdsLease) offered.push('disconnect-runtime');
  if (requiresAuthorization(provider) && facts.authorization?.grant !== 'absent') offered.push('logout');
  if (!facts.connection?.sealed && !provider?.sealed) offered.push('remove');
  if (provider?.auth?.revokeUrl) offered.push('revoke-at-provider');
  return offered;
}

function effectGroups(provider) {
  const grouped = new Map();
  for (const operation of list(provider?.operations)) {
    if (!grouped.has(operation.effect)) grouped.set(operation.effect, []);
    grouped.get(operation.effect).push(operation.tool);
  }
  return EFFECT_ORDER.filter(effect => grouped.get(effect)?.length).map(effect => ({ effect, tools: grouped.get(effect).sort() }));
}

function cardActions(provider, facts, state, authorized) {
  // A grant that once existed is renewed, not joined again, so the host can
  // preserve the connection when the user cancels.
  const reconnect = requiresAuthorization(provider) && facts.authorization?.grant !== 'absent' ? 'reauthorize' : 'connect';
  switch (state) {
    case 'needs-configuration': return ['configure', provider?.docsUrl ? ['open-docs'] : []];
    case 'disabled': return ['enable', ['configure']];
    case 'waiting-for-approval': case 'connecting':
      return facts.runtime?.holdsLease && !facts.attempt ? ['disconnect-runtime', ['configure']] : ['cancel-attempt', []];
    case 'needs-authorization': return [reconnect, ['configure', ...(provider?.auth?.revokeUrl ? ['revoke-at-provider'] : [])]];
    case 'connected': return ['disconnect-runtime', ['verify', 'configure']];
    case 'verified': return ['verify', ['configure', 'disable']];
    case 'not-verified': return ['verify', ['configure']];
    case 'needs-attention': return ['retry', ['configure', ...(requiresAuthorization(provider) && !authorized ? [reconnect] : [])]];
    default: return requiresAuthorization(provider) && facts.authorization?.grant !== 'present'
      ? ['connect', ['configure']] : ['verify', ['configure']];
  }
}

function cardBadges(provider, facts, missingScopes, tools) {
  const badges = [];
  if (facts.connection?.sealed || provider?.sealed) badges.push('source-builtin');
  if (requiresAuthorization(provider)) badges.push('auth-required');
  else if (!provider?.auth?.mode || provider.auth.mode === 'none') badges.push('no-auth');
  if (facts.runtime?.holdsLease) badges.push('lease-held');
  else if (facts.runtime?.lastProbe?.outcome === 'verified') badges.push('probe-released');
  if (facts.authorization?.grant === 'indeterminate') badges.push('grant-unknown');
  if (missingScopes.length) badges.push('scope-limited');
  if (tools.needsApproval.length) badges.push('approval-required');
  if (provider?.multipleConnections) badges.push('multi-account');
  if (facts.lastMutation && !mutationSucceeded(facts.lastMutation)) badges.push('partial-mutation');
  return badges;
}

/**
 * Projects independent facts onto one card. The order of the checks is the
 * whole design: an in-flight transaction outranks any resting state, a missing
 * precondition outranks a failed attempt to use it, and a runtime failure never
 * outranks a valid grant — so an authorized but temporarily offline connection
 * is never sent back through a login.
 *
 * Pass a null provider for a connection that outlived its directory entry.
 */
export function deriveConnectionView(provider, facts, now = Date.now()) {
  const connection = facts.connection ?? {};
  const authorization = facts.authorization ?? { grant: 'absent' };
  const runtime = facts.runtime ?? {};
  const pending = facts.pending?.kind ?? '';
  const probe = runtime.lastProbe ?? { outcome: 'never' };
  const configuration = configurationState(connection, provider);
  const authorized = grantUsable(authorization, now);
  const attemptLive = !!facts.attempt && !TERMINAL_ATTEMPT_STATES.has(facts.attempt.state);
  const partial = !!facts.lastMutation && !mutationSucceeded(facts.lastMutation);
  const needsAuth = requiresAuthorization(provider);

  let state, reason;
  if (!provider) [state, reason] = ['needs-attention', 'provider-unavailable'];
  else if (attemptLive && facts.attempt.state === 'waiting-for-approval') [state, reason] = ['waiting-for-approval', 'awaiting-consent'];
  else if (attemptLive || pending === 'connect') [state, reason] = ['connecting', 'runtime-starting'];
  else if (pending === 'probe' || runtime.phase === 'starting' || runtime.phase === 'installing') [state, reason] = ['connecting', 'runtime-starting'];
  else if (!configuration.complete) [state, reason] = ['needs-configuration', 'configuration-incomplete'];
  // A half-applied change outranks the resting state it was meant to produce:
  // a disable whose runtime never stopped is not simply "disabled".
  else if (partial) [state, reason] = ['needs-attention', 'partial-mutation'];
  else if (!connection.enabled) [state, reason] = ['disabled', 'disabled-by-user'];
  else if (needsAuth && authorization.grant === 'absent') [state, reason] = ['needs-authorization', 'grant-absent'];
  else if (needsAuth && authorization.failure) [state, reason] = ['needs-authorization', 'grant-rejected'];
  else if (needsAuth && grantExpired(authorization, now)) [state, reason] = ['needs-authorization', 'grant-expired'];
  else if (runtime.phase === 'install-failed') [state, reason] = ['needs-attention', 'install-failed'];
  else if (runtime.phase === 'start-failed') [state, reason] = ['needs-attention', 'start-failed'];
  // A lookup that failed is not an answer: reporting "not authorized" here
  // would send a signed-in user through a login they do not need.
  else if (needsAuth && authorization.grant === 'indeterminate') [state, reason] = ['needs-attention', 'grant-indeterminate'];
  else if (runtime.holdsLease && runtime.phase === 'ready') [state, reason] = ['connected', 'runtime-live'];
  // Verified and released is not "online": the session that proved the
  // capability was handed back on purpose.
  else if (probe.outcome === 'verified') [state, reason] = ['verified', 'probe-verified'];
  else if (probe.outcome === 'failed') [state, reason] = ['needs-attention', 'probe-failed'];
  else if (probe.outcome === 'cancelled') [state, reason] = ['not-verified', 'probe-cancelled'];
  else if (authorized || (!needsAuth && authorization.grant === 'present')) [state, reason] = ['not-verified', 'grant-present-unverified'];
  else [state, reason] = ['not-connected', 'never-connected'];

  const tools = resolveToolPolicy(facts.policy);
  const missingScopes = scopeShortfall(provider, authorization);
  const [primary, secondary] = cardActions(provider, facts, state, authorized);
  return {
    connectionId: connection.connectionId, providerId: connection.providerId,
    displayName: provider?.displayName || connection.connectionId,
    accountLabel: connection.accountLabel ?? '',
    origin: connection.origin ?? '', transport: provider?.transport ?? '',
    state, reason, primary, secondary,
    ...(['explicit-v1', 'legacy-final-text'].includes(runtime.deliveryMode) ? { deliveryMode: runtime.deliveryMode } : {}),
    badges: cardBadges(provider, facts, missingScopes, tools),
    busy: !!pending, pending,
    attempt: facts.attempt
      ? { attemptId: facts.attempt.attemptId, intent: facts.attempt.intent, state: facts.attempt.state, expiresAtMs: facts.attempt.expiresAtMs, pollIntervalMs: facts.attempt.pollIntervalMs,
          // Only a user-qr attempt ever carries this; every other provider's
          // attempt view is unchanged.
          ...(facts.attempt.qr ? { qr: facts.attempt.qr } : {}) }
      : null,
    tools, scope: { effects: effectGroups(provider), missingScopes },
    capabilities: list(provider?.capabilities),
    configuration,
    lifecycle: offeredLifecycle(provider, facts),
    nextStep: nextStep(facts.lastMutation),
    code: runtime.code ?? facts.lastMutation?.code ?? '',
    revision: connection.revision ?? '',
    sealed: !!(connection.sealed || provider?.sealed),
    enabled: !!connection.enabled,
    credentialHolder: provider?.auth?.credentialHolder ?? '',
    docsUrl: provider?.docsUrl ?? '', revokeUrl: provider?.auth?.revokeUrl ?? '',
  };
}

/** Projects a whole directory at once, keeping cards whose entry vanished. */
export const deriveConnectionViews = (catalog, facts, now = Date.now()) =>
  list(facts).map(fact => deriveConnectionView(catalog?.provider(fact.connection?.providerId) ?? null, fact, now));
