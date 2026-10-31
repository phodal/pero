import { mergeResearchDiscovery, researchFields, seedDefinition } from './connector-definition.mjs';

export const emptyDiscovery = () => ({
  state: 'idle', command: [], matlabRoot: [], extensionFile: [], manual: false,
  installable: false, installSummary: null, installError: null, install: null, continueAfterInstall: false,
});

export function initialConnectorDetail() {
  return {
    phase: 'closed', generation: 0, request: 0, activeRequest: null, editRevision: 0, discardArmed: false,
    detailConnectorId: null, detailProviderId: null, connectorIdField: '',
    definitionText: '', baseline: '', editMode: 'form',
    secretReference: '', fieldError: null, discovery: emptyDiscovery(),
  };
}

// Client workflow only. Host replies still own connection/consent state; effects
// describe existing operations and cannot grant permission or retry a mutation.
const poll = (state, providerId) => ({ kind: 'poll', providerId, generation: state.generation });

export function updateConnectorDetail(state, event) {
  const result = (next = state, effects = []) => ({ state: next, effects });
  const request = (next, operation) => {
    next = { ...next, request: next.request + 1, activeRequest: operation,
      discovery: { ...next.discovery, state: operation === 'discover' ? 'running' : 'preparing', installError: null } };
    return result(next, [{ kind: 'request', operation, providerId: next.detailProviderId,
      generation: next.generation, request: next.request, editRevision: next.editRevision }]);
  };
  switch (event.type) {
    case 'opened': {
      const next = { ...initialConnectorDetail(), ...event.initial,
        phase: 'editing', generation: state.generation + 1, request: state.request };
      return event.discover ? request(next, 'discover') : result(next);
    }
    case 'close.requested':
      if (event.busy) return result(state, [{ kind: 'notice', key: 'busy', error: false }]);
      if (!event.force && state.definitionText !== state.baseline && !state.discardArmed)
        return result({ ...state, discardArmed: true }, [{ kind: 'notice', key: 'unsaved', error: true }]);
      return result({ ...initialConnectorDetail(), generation: state.generation + 1, request: state.request }, [{ kind: 'closed' }]);
    case 'field.changed': {
      if (state.phase === 'closed') return result();
      // No secrets, transport objects or callbacks enter this replayable state.
      if (!['connectorIdField', 'definitionText', 'editMode', 'secretReference', 'fieldError'].includes(event.field)) return result();
      const draftChanged = event.field === 'definitionText' || event.field === 'connectorIdField';
      return result({ ...state, [event.field]: event.value,
        ...(draftChanged ? { editRevision: state.editRevision + 1, discardArmed: false, fieldError: null } : {}) });
    }
    case 'saved':
      if (state.phase === 'closed' || event.generation !== state.generation) return result();
      return result({ ...state, detailConnectorId: event.connectorId, baseline: event.text, discardArmed: false });
    case 'manual.requested':
      return state.phase === 'closed' ? result() : result({ ...state, discovery: { ...state.discovery, manual: true } });
    case 'discovery.requested':
    case 'install.requested':
      if (state.phase === 'closed' || !state.detailProviderId) return result();
      return request({ ...state, discovery: { ...state.discovery, continueAfterInstall: false } }, event.type === 'discovery.requested' ? 'discover' : 'install.run');
    case 'request.completed': {
      const effect = event.effect;
      if (state.phase === 'closed' || effect.generation !== state.generation || effect.request !== state.request || effect.operation !== state.activeRequest) return result();
      const reply = event.reply;
      if (effect.operation === 'install.run') {
        const next = { ...state, activeRequest: null, discovery: { ...state.discovery, state: 'done', installError: reply.ok ? null : event.error, install: reply.ok ? reply.job : null } };
        return reply.ok && reply.job?.state === 'running' ? result(next, [poll(state, effect.providerId)]) : result(next);
      }
      if (!reply.ok) return result({ ...state, activeRequest: null, discovery: { ...state.discovery, state: 'failed' } });
      let definitionText = state.definitionText, baseline = state.baseline;
      // Discovery may update its status after typing, but must not replace an
      // edited definition. A fresh explicit retry can adopt a new discovery.
      if (effect.editRevision === state.editRevision) {
        if (researchFields[effect.providerId]) {
          try { definitionText = JSON.stringify(mergeResearchDiscovery(JSON.parse(definitionText), reply.definition), null, 2); } catch { /* preserve incomplete JSON */ }
        } else if (reply.definition || !state.detailConnectorId) {
          let discovered = reply.definition ?? seedDefinition(event.provider);
          if (effect.providerId === 'feishu-workspace' && state.detailConnectorId && reply.definition) {
            try { const current = JSON.parse(definitionText); if (Array.isArray(current.tools)) discovered = { ...discovered, tools: current.tools }; } catch { /* retain the validated discovery */ }
          }
          definitionText = JSON.stringify(discovered, null, 2);
          if (!state.detailConnectorId) baseline = definitionText;
        }
      }
      return result({ ...state, activeRequest: null, definitionText, baseline, discovery: { ...state.discovery, state: 'done',
        command: reply.found.command, matlabRoot: reply.found.matlabRoot, extensionFile: reply.found.extensionFile,
        nativeCli: reply.found.nativeCli, account: reply.found.account, setupError: reply.found.setupError,
        installable: !!reply.installable, installSummary: reply.installSummary ?? null, installError: null, install: reply.install ?? null } },
        reply.install?.state === 'running' ? [poll(state, effect.providerId)] : []);
    }
    case 'install.progress': {
      if (state.phase === 'closed' || event.generation !== state.generation || state.discovery.install?.state !== 'running') return result();
      const job = event.job;
      const discovery = { ...state.discovery, install: job, installError: null };
      if (job?.state === 'running') return result({ ...state, discovery });
      // A finished install re-runs discovery so the found executable is adopted,
      // and the panel continues to add the connection the person asked to install.
      return job?.state === 'done' ? request({ ...state, discovery: { ...discovery, continueAfterInstall: true } }, 'discover') : result({ ...state, discovery });
    }
    case 'install.cancel':
      return state.phase === 'closed' ? result() : result(state, [{ kind: 'cancel', providerId: state.detailProviderId }]);
    default: return result();
  }
}
