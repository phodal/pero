import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seedDefinition, researchFields, secretReferences } from './connector-definition.mjs';
import { initialConnectorDetail, updateConnectorDetail, type ConnectorDetailState, type DetailEffect, type DetailEvent, type DetailField } from './connector-detail-model.mjs';
import { errorText } from './shared/connection-copy.mjs';
import type { ConnectionView, DirectoryEntry, ImportDraft, RawEntry, Reply } from './connector-types.ts';

type Options = {
  directory: DirectoryEntry[]; connections: ConnectionView[]; entries: RawEntry[];
  locale: 'zh' | 'en'; settingsOnly: boolean; isBusy: () => boolean;
  request: (payload: Record<string, unknown>) => Promise<Reply>;
  say: (text: string, error?: boolean) => void;
  openDocs: (providerId: string) => void;
  onClosed: () => void;
};

/** Serial event delivery, explicit effects, and one editor lifetime. No domain
 * facts, approvals or mutation retries are implemented by this client model. */
export function useConnectorDetail(options: Options) {
  const current = useRef(options); current.current = options;
  const [state, publish] = useState(initialConnectorDetail);
  const stateRef = useRef(state);
  // Secrets are ephemeral UI input, excluded from replayable events/effects.
  const [secretValue, setSecretValue] = useState('');
  const mounted = useRef(true);
  const execute = useRef<(effect: DetailEffect) => void>(() => {});
  const dispatch = useCallback((event: DetailEvent) => {
    if (!mounted.current) return;
    const result = updateConnectorDetail(stateRef.current, event);
    stateRef.current = result.state;
    publish(result.state);
    if (event.type === 'opened' || result.effects.some(effect => effect.kind === 'closed')) setSecretValue('');
    for (const effect of result.effects) execute.current(effect);
  }, []);

  execute.current = effect => {
    const opt = current.current;
    const copy = (zh: string, en: string) => opt.locale === 'zh' ? zh : en;
    if (effect.kind === 'notice') {
      opt.say(effect.key === 'busy' ? copy('请先等待当前操作完成。', 'Wait for the current operation to finish.')
        : copy('有未保存的修改。再次关闭将放弃这些修改。', 'Unsaved changes. Close again to discard them.'), effect.error);
    } else if (effect.kind === 'closed') {
      opt.say(''); opt.onClosed();
    } else if (effect.kind === 'request') {
      // Existing Host transport decides authority, consent and execution.
      // A missing response is not replayed; only a new user event starts work.
      void opt.request({ operation: effect.operation, providerId: effect.providerId })
        .catch(() => ({ ok: false, code: 'MCP_INSTALL_FAILED' } as Reply))
        .then(reply => dispatch({ type: 'request.completed', effect, reply,
          error: errorText(reply.code, current.current.locale),
          provider: current.current.directory.find(entry => entry.providerId === effect.providerId) }));
    } else if (effect.kind === 'cancel') {
      void opt.request({ operation: 'install.cancel', providerId: effect.providerId }).catch(() => undefined);
    } else {
      // Status polling only reads the Host's job; it never starts or retries one.
      const tick = () => {
        if (!mounted.current || stateRef.current.generation !== effect.generation) return;
        void opt.request({ operation: 'install.status', providerId: effect.providerId })
          .catch(() => ({ ok: false } as Reply))
          .then(reply => {
            if (!mounted.current || stateRef.current.generation !== effect.generation) return;
            dispatch({ type: 'install.progress', generation: effect.generation, job: reply.ok ? reply.job ?? null : { state: 'failed', log: '', exitCode: null } });
            if (stateRef.current.discovery.install?.state === 'running') window.setTimeout(tick, 1000);
          });
      };
      window.setTimeout(tick, 1000);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const change = <K extends DetailField>(field: K, value: ConnectorDetailState[K]) => dispatch({ type: 'field.changed', field, value });
  const openDetail = (connectorId: string | null, providerId: string | null = null, draft: ImportDraft | null = null) => {
    const opt = current.current;
    if (opt.isBusy()) return;
    const view = opt.connections.find(row => row.connectionId === connectorId) ?? null;
    const raw = opt.entries.find(row => row.connectorId === connectorId) ?? null;
    const provider = opt.directory.find(row => row.providerId === (view?.providerId ?? providerId)) ?? null;
    if (!connectorId && provider?.listed) {
      opt.openDocs(provider.providerId);
      opt.onClosed(); return;
    }
    let id = view?.connectionId ?? draft?.connectorId ?? '';
    if (provider && !view && !draft) {
      const taken = new Set(opt.connections.map(row => row.connectionId));
      id = provider.providerId;
      for (let n = 2; taken.has(id); n++) id = `${provider.providerId}-${n}`;
    }
    const definition = raw?.definition ?? draft?.definition ?? seedDefinition(provider);
    const text = JSON.stringify(definition, null, 2);
    dispatch({ type: 'opened', initial: {
      detailConnectorId: connectorId, detailProviderId: provider?.providerId ?? providerId,
      connectorIdField: id, definitionText: text, baseline: draft ? '' : text,
      secretReference: secretReferences(definition)[0] ?? '',
    }, discover: !!provider?.discovery && !view && !draft });
    opt.say(draft ? (draft.notes.length ? (opt.locale === 'zh' ? `已从 JSON 导入，还有几项需要补全：${draft.notes.join(' ')}` : `Imported JSON. A few items still need attention: ${draft.notes.join(' ')}`)
      : opt.locale === 'zh' ? '已从 JSON 导入，确认后保存。' : 'Imported JSON. Review before saving.') : '');
  };
  const provider = options.directory.find(row => row.providerId === state.detailProviderId) ?? null;
  const view = options.connections.find(row => row.connectionId === state.detailConnectorId) ?? null;
  const parsedDefinition = useMemo(() => { try { return JSON.parse(state.definitionText); } catch { return null; } }, [state.definitionText]);
  return {
    ...state, detailOpen: state.phase === 'editing', isDirty: state.definitionText !== state.baseline,
    provider, view, parsedDefinition, secretValue, setSecretValue,
    quickInstall: !!provider?.discovery && !view && !state.discovery.manual && !researchFields[provider?.providerId ?? ''],
    managedProvider: ['gitlab', 'github', 'linear', 'microsoft-365'].includes(provider?.providerId ?? ''),
    openDetail, closeDetail: (force = false) => dispatch({ type: 'close.requested', busy: current.current.isBusy(), force }),
    discover: (_providerId?: string) => dispatch({ type: 'discovery.requested' }),
    installServer: (_providerId?: string) => dispatch({ type: 'install.requested' }),
    cancelInstall: () => dispatch({ type: 'install.cancel' }),
    useManual: () => dispatch({ type: 'manual.requested' }),
    markSaved: (connectorId: string, text: string, generation: number) => dispatch({ type: 'saved', connectorId, text, generation }),
    setConnectorIdField: (value: string) => change('connectorIdField', value),
    setDefinitionText: (value: string) => change('definitionText', value),
    setEditMode: (value: 'form' | 'json') => change('editMode', value),
    setSecretReference: (value: string) => change('secretReference', value),
    setFieldError: (value: ConnectorDetailState['fieldError']) => change('fieldError', value),
    patchDefinition: (patch: Record<string, any>) => {
      try { change('definitionText', JSON.stringify({ ...JSON.parse(stateRef.current.definitionText), ...patch }, null, 2)); }
      catch { /* incomplete JSON stays editable */ }
    },
  };
}

export type ConnectorDetailController = ReturnType<typeof useConnectorDetail>;
