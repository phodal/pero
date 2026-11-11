import { useEffect, useRef, useState } from "react";
import { useAppInfo, useAppI18n } from "./host";
import { Button, Disclosure, Feedback, Icon, IconButton, Select, Table } from "./ui";
import { CanvasActionForm, type CanvasAction } from "./canvas-action-form";

export interface CanvasSource {
  entryId: string;
  revision: number;
  blockId: string;
  readOnly: boolean;
  binding: {
    id: string;
    app: string;
    panel: string;
    view: string;
    declaration: string;
    inputs: Record<string, unknown>;
  };
}
interface Projection {
  title: string;
  fields: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
  notice: string;
  actions: CanvasAction[];
  results?: { id: string; label: string; value: Record<string, unknown> }[];
}
interface MountedView {
  instance: string;
  source: CanvasSource;
  projection: Projection;
  history?: { operationId: string; action: string; state: string }[];
}
interface ActionResult {
  state: string;
  message?: string;
  receipt?: Record<string, unknown>;
}
async function request<T>(body: object): Promise<T> {
  const response = await fetch("/host/canvas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    keepalive: "operation" in body && body.operation === "release",
  });
  if (!response.ok)
    throw new Error(
      (await response.text()).slice(0, 1000) || "App Canvas is unavailable",
    );
  return response.json();
}
const messages = {
  otherActions: { en: 'Other actions', zh: '其他操作' },
  receipt: { en: 'Action details', zh: '操作详情' },
  results: { en: 'Completed results', zh: '已完成的结果' },
  chooseResult: { en: 'Choose a result to attach', zh: '选择要附加的结果' },
  attachResult: { en: 'Attach selected result', zh: '附加所选结果' },
  loading: { en: "Loading declared App view…", zh: "正在载入声明的 App 视图…" },
  refresh: { en: "Refresh App view", zh: "刷新 App 视图" },
  confirm: {
    en: "Waiting for trusted Host confirmation…",
    zh: "正在等待可信 Host 确认…",
  },
  cancel: { en: "Cancel pending action", zh: "取消待确认操作" },
  status: { en: "Check action status", zh: "检查操作状态" },
  cancelled: {
    en: "Action cancelled before execution.",
    zh: "操作在执行前已取消。",
  },
  complete: {
    en: "The App returned a completed result. This is not independent verification.",
    zh: "App 已返回完成结果。这不代表独立验证通过。",
  },
  notApplied: {
    en: "The App did not apply this change. Refresh the view and review the current values before trying again.",
    zh: "App 未应用此变更。请刷新视图，核对当前值后再试。",
  },
  unknown: {
    en: "The action outcome is not yet known. Check status before repeating it.",
    zh: "操作结果尚不明确。重复操作前请检查状态。",
  },
  history: { en: "Inspect retained action", zh: "检查保留的操作" },
  retain: {
    en: "Keep returned result in notebook",
    zh: "将返回结果保留到笔记",
  },
  readonly: {
    en: "Read-only view. Actions are unavailable in this instance.",
    zh: "只读视图，此实例不可操作。",
  },
};
/** Renders bounded owner data, not App HTML or scripts. All actions return through the Host. */
export function DeclaredAppCanvas({
  source,
  onResult,
  onAttachResult,
  secondaryActions = false,
  primaryAction,
}: {
  source: CanvasSource;
  onResult?: (receipt: Record<string, unknown>) => void;
  onAttachResult?: (value: Record<string, unknown>) => void;
  secondaryActions?: boolean;
  primaryAction?: string;
}) {
  const { t } = useAppI18n(messages),
    active = useAppInfo().active;
  const [view, setView] = useState<MountedView | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(false),
    [running, setRunning] = useState(false),
    [result, setResult] = useState<ActionResult | null>(null);
  const [selectedResult, setSelectedResult] = useState('');
  const instance = useRef(""),
    pending = useRef(false),
    operation = useRef(""),
    epoch = useRef(0);
  const serialized = JSON.stringify(source);
  const mount = async (generation: number) => {
    setLoading(true);
    setError("");
    try {
      const value = await request<MountedView>({
        operation: "mount",
        source: JSON.parse(serialized),
      });
      if (generation !== epoch.current) {
        void request({ operation: "release", instance: value.instance }).catch(
          () => {},
        );
        return;
      }
      instance.current = value.instance;
      setView(value);
    } catch (cause) {
      if (generation === epoch.current) setError(String(cause));
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  };
  useEffect(() => {
    const generation = ++epoch.current;
    setView(null);
    setResult(null);
    setSelectedResult('');
    setRunning(false);
    pending.current = false;
    operation.current = "";
    if (active) void mount(generation);
    return () => {
      epoch.current++;
      const id = instance.current;
      instance.current = "";
      if (id)
        void request({ operation: "release", instance: id }).catch(() => {});
    };
  }, [serialized, active]);
  const refresh = async () => {
    if (loading || pending.current) return;
    if (!instance.current) {
      await mount(epoch.current);
      return;
    }
    const generation = epoch.current;
    setLoading(true);
    setError("");
    try {
      const value = await request<MountedView>({
        operation: "read",
        instance: instance.current,
      });
      if (generation === epoch.current) setView(value);
    } catch (cause) {
      if (generation === epoch.current) {
        setError(String(cause));
        setView(null);
      }
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  };
  const act = async (action: Projection["actions"][number]) => {
    if (pending.current || source.readOnly || !instance.current) return;
    const generation = epoch.current;
    pending.current = true;
    setRunning(true);
    setResult(null);
    setError("");
    operation.current = crypto.randomUUID();
    try {
      const value = await request<ActionResult>({
        operation: "act",
        instance: instance.current,
        operationId: operation.current,
        action: action.name,
        params: action.params,
      });
      if (generation === epoch.current) setResult(value);
    } catch (cause) {
      if (generation === epoch.current) {
        setError(String(cause));
        setResult({ state: "outcome-unknown" });
      }
    } finally {
      if (generation === epoch.current) {
        pending.current = false;
        setRunning(false);
      }
    }
  };
  const inspect = async (cancel: boolean, retained?: string) => {
    if (retained) operation.current = retained;
    if (!instance.current || !operation.current) return;
    const generation = epoch.current, inspected = operation.current;
    try {
      const value = await request<ActionResult>({
        operation: cancel ? "cancel" : "status",
        instance: instance.current,
        operationId: inspected,
      });
      if (generation === epoch.current && operation.current === inspected) {
        setResult(value);
        if (value.state === "completed")
          setView((current) =>
            current
              ? {
                  ...current,
                  history: current.history?.map((item) =>
                    item.operationId === inspected
                      ? { ...item, state: "retained" }
                      : item,
                  ),
                }
              : current,
          );
      }
    } catch (cause) {
      if (generation === epoch.current && operation.current === inspected) {
        setError(String(cause));
        setResult({ state: "outcome-unknown" });
      }
    }
  };
  const ownerResult = result?.receipt?.result;
  const notApplied = !!ownerResult && typeof ownerResult === 'object' && 'outcome' in ownerResult && ownerResult.outcome === 'not-applied';
  const actionForms = view?.projection.actions.map(action => <CanvasActionForm
    key={`${view.instance}:${action.name}`} action={action} primary={!secondaryActions && action.name === primaryAction}
    disabled={running || loading || result?.state === 'outcome-unknown' || !!view.history?.some(item => item.state === 'outcome-unknown')}
    onSubmit={value => void act(value)} />);
  return (
    <section className="pero-app-canvas" aria-label="Declared App view" aria-busy={loading || running}>
      <div className="pero-app-canvas-heading">
        {view && <strong>{view.projection.title}</strong>}
        <IconButton label={t('refresh')} disabled={loading || running} onClick={() => void refresh()}><Icon name="sync" /></IconButton>
      </div>
      {loading && <p role="status">{t("loading")}</p>}
      {view && (
        <>
          <dl className="pero-app-canvas-fields">
            {view.projection.fields.map((field, index) => (
              <div key={index}>
                <dt>{field.label}</dt>
                <dd>{field.value || "—"}</dd>
              </div>
            ))}
          </dl>
          {!!view.projection.columns.length && (
            <Table label={view.projection.title} density="compact">
              <thead>
                <tr>
                  {view.projection.columns.map((label, index) => (
                    <th key={index}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.projection.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) => (
                      <td key={column}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {view.projection.notice && <p>{view.projection.notice}</p>}
          {onAttachResult && !source.readOnly && !!view.projection.results?.length && <div className="pero-app-canvas-attach">
            <Select label={t('results')} placeholder={t('chooseResult')} value={selectedResult}
              disabled={loading || running} options={view.projection.results.map(item => ({ value: item.id, label: item.label }))}
              onChange={setSelectedResult} />
            <Button variant="primary" disabled={loading || running || !view.projection.results.some(item => item.id === selectedResult)} onClick={() => {
              const selected = view.projection.results?.find(item => item.id === selectedResult);
              if (selected) onAttachResult(selected.value);
            }}>{t('attachResult')}</Button>
          </div>}
          {source.readOnly ? (
            <p>{t("readonly")}</p>
          ) : secondaryActions ? (
            <Disclosure variant="inline" summary={t('otherActions')}>{actionForms}</Disclosure>
          ) : actionForms}
        </>
      )}
      {!!view?.history?.length && (
        <Disclosure variant="inline" summary={t('history')}>
          {view.history.map((item) => (
            <p key={item.operationId}>
              {item.action} · {item.operationId} · {item.state}{" "}
              <Button
                disabled={running}
                onClick={() => void inspect(false, item.operationId)}
              >
                {t("status")}
              </Button>
            </p>
          ))}
        </Disclosure>
      )}
      {running && (
        <>
          <p role="status">{t("confirm")}</p>
          <Button onClick={() => void inspect(true)}>{t("cancel")}</Button>
        </>
      )}
      {operation.current && (
        <Button onClick={() => void inspect(false)}>{t("status")}</Button>
      )}
      {result && (
        <Feedback
          kind={result.state === "outcome-unknown" || notApplied ? "warning" : "info"}
        >
          {t(
            notApplied ? "notApplied" : result.state === "completed"
              ? "complete"
              : result.state === "cancelled"
                ? "cancelled"
                : "unknown",
          )}
        </Feedback>
      )}
      {result?.receipt && (
        <>
          <Disclosure variant="inline" summary={t('receipt')}><pre>{JSON.stringify(result.receipt, null, 2)}</pre></Disclosure>
          {onResult && !source.readOnly && (
            <Button onClick={() => onResult(result.receipt!)}>
              {t("retain")}
            </Button>
          )}
        </>
      )}
      {error && <Feedback kind="error">{error}</Feedback>}
    </section>
  );
}
