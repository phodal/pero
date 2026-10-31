import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  appObjectProps,
  downloadFile,
  useAppApi,
  useAppChat,
  useAppDataChanged,
  useAppObject,
} from "@pero/app-sdk";
import type { Capability, Experiment, Field, Summary, Template } from "./types";
import { draftRangeError, matchingCandidate } from "./presentation";
import { Results, Evidence } from "./results";
import "./styles.css";
const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
function Fields({
  fields,
  values,
  change,
}: {
  fields: Field[];
  values: Record<string, number>;
  change: (name: string, value: number) => void;
}) {
  return (
    <>
      {fields.map((field) => (
        <label className="field" key={field.name}>
          <span>
            {field.label}
            {field.unit && <small> ({field.unit})</small>}
          </span>
          <input
            type="number"
            required
            aria-label={field.label}
            min={field.min}
            max={field.max}
            step={field.name === "samples" ? 1 : "any"}
            readOnly={field.min === field.max}
            value={
              Number.isNaN(values[field.name])
                ? ""
                : (values[field.name] ?? field.value)
            }
            onChange={(event) => change(field.name, event.target.valueAsNumber)}
          />
        </label>
      ))}
    </>
  );
}
export default function ControlLab() {
  const api = useAppApi(),
    chat = useAppChat();
  const [templates, setTemplates] = useState<Template[]>([]),
    [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [history, setHistory] = useState<Summary[]>([]),
    [templateId, setTemplateId] = useState("");
  const [parameters, setParameters] = useState<Record<string, number>>({}),
    [criteria, setCriteria] = useState<Record<string, number>>({});
  const [experiment, setExperiment] = useState<Experiment | null>(null),
    [selectedId, setSelectedId] = useState("baseline");
  const [budget, setBudget] = useState(6),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [draft, setDraft] = useState<Record<string, number> | null>(null);
  const selection = useRef(0),
    pending = useRef(false),
    pendingSelect = useRef<Record<string, number> | null>(null);
  const template = templates.find((item) => item.id === templateId),
    running = experiment?.status === "running";
  const onError = (value: unknown) =>
    setError(value instanceof Error ? value.message : String(value));
  const refreshHistory = useCallback(async () => {
    const result = await api.get<{ experiments: Summary[] }>(
      "/api/experiments",
    );
    setHistory(result.experiments);
  }, [api]);
  function chooseTemplate(item: Template) {
    setTemplateId(item.id);
    setParameters(
      Object.fromEntries(item.parameters.map((f) => [f.name, f.value])),
    );
    setCriteria(
      Object.fromEntries(item.criteria.map((f) => [f.name, f.value])),
    );
  }
  const initialize = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{
        templates: Template[];
        capabilities: Capability[];
      }>("/api/templates");
      setTemplates(data.templates);
      setCapabilities(data.capabilities);
      if (data.templates[0]) chooseTemplate(data.templates[0]);
      await refreshHistory();
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [api, refreshHistory]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  async function open(id: string) {
    const revision = ++selection.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.get<Experiment>(
        `/api/experiments/${encodeURIComponent(id)}`,
      );
      if (revision === selection.current) {
        setExperiment(result);
        setSelectedId(
          result.lockedCandidateId ??
            result.candidates.at(-1)?.id ??
            "baseline",
        );
        setDraft(null);
        pendingSelect.current = null;
        setBudget(result.candidateBudget);
      }
    } catch (error) {
      if (revision === selection.current) onError(error);
    } finally {
      if (revision === selection.current) setBusy(false);
    }
  }
  useAppDataChanged(async () => {
    try {
      await refreshHistory();
      if (experiment) await open(experiment.id);
    } catch (error) {
      onError(error);
    }
  });
  useEffect(() => {
    if (!experiment || !running) return;
    const id = experiment.id,
      revision = selection.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.get<Experiment>(
          `/api/experiments/${encodeURIComponent(id)}`,
        );
        if (disposed || revision !== selection.current) return;
        setExperiment(next);
        if (next.status === "running") timer = setTimeout(poll, 600);
        else await refreshHistory();
      } catch (error) {
        if (!disposed && revision === selection.current) {
          onError(error);
          timer = setTimeout(poll, 2000);
        }
      }
    }
    timer = setTimeout(poll, 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, experiment?.id, running, refreshHistory]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2700);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!experiment || experiment.status === "running" || !pendingSelect.current) return;
    const wanted = pendingSelect.current;
    pendingSelect.current = null;
    const names = Object.keys(experiment.searchSpace);
    const match = matchingCandidate(experiment.candidates, wanted, names);
    if (!match) return;
    setSelectedId(match.id);
    setDraft(null);
    setNotice(experiment.error ? "Run finished with a solver error." : "Run finished.");
  }, [experiment]);
  async function create(source?: Experiment) {
    if (pending.current) throw new Error("An operation is already pending.");
    pending.current = true;
    const revision = selection.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<Experiment>("/api/experiments", {
        templateId: source?.templateId ?? templateId,
        parameters: source?.parameters ?? parameters,
        criteria: source?.criteria ?? criteria,
        candidateBudget: source?.candidateBudget ?? budget,
      });
      if (revision === selection.current) {
        selection.current++;
        setExperiment(result);
        setSelectedId("baseline");
        setDraft(null);
      }
      await refreshHistory();
      return result;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function exportEvidence(id: string) {
    const response = await fetch(
      `/api/experiments/${encodeURIComponent(id)}/export`,
      {
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok)
      throw new Error(
        `Evidence export failed (${response.status}). Try exporting again.`,
      );
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      throw new Error(
        "Evidence export returned an unsupported response. Expected JSON.",
      );
    }
    // Preserve canonical numeric spellings (including -0.0 and 1.0). Parsing
    // and reserializing here changes the bytes used by scientific evidence IDs.
    const evidence = await response.text();
    downloadFile(`control-lab-${id}.json`, evidence, "application/json");
  }
  function freezeSpecification(form: HTMLFormElement | null) {
    // App frames intentionally do not grant allow-forms. Validate locally,
    // then use the authenticated App API rather than native form submission.
    if (loading || busy || pending.current || !form?.reportValidity()) return;
    void create().catch(onError);
  }
  async function act(action: string, body: object = {}) {
    if (!experiment) throw new Error("Freeze a specification first.");
    if (pending.current) throw new Error("An operation is already pending.");
    pending.current = true;
    const revision = selection.current;
    const id = experiment.id;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<Experiment>(
        `/api/experiments/${encodeURIComponent(id)}/${action}`,
        body,
      );
      if (revision === selection.current) setExperiment(result);
      await refreshHistory();
      return result;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function newExperiment() {
    if (pending.current) return;
    selection.current++;
    setExperiment(null);
    setDraft(null);
    pendingSelect.current = null;
    setError("");
  }
  function selectCandidate(id: string) {
    setSelectedId(id);
    setDraft(null);
  }
  async function runDraft() {
    if (!experiment) throw new Error("Freeze a specification first.");
    const names = Object.keys(experiment.searchSpace);
    const parameters = Object.fromEntries(names.map((name) => [name, currentDraft[name]]));
    const problem = draftRangeError(parameters, experiment.searchSpace);
    if (problem) {
      setError(problem);
      setNotice(problem);
      return;
    }
    const existing = matchingCandidate(experiment.candidates, parameters, names);
    if (existing) {
      setSelectedId(existing.id);
      setDraft(null);
      setError("");
      setNotice("Matching candidate selected");
      return;
    }
    setError("");
    setNotice("Run started");
    pendingSelect.current = parameters;
    try {
      await act("propose", { parameters });
    } catch (error) {
      pendingSelect.current = null;
      setNotice("");
      throw error;
    }
  }
  useAppObject({
    id: "control-lab",
    kind: "engineering-experiment",
    label: "Control Lab",
    state: {
      loading,
      busy,
      experimentId: experiment?.id ?? null,
      specHash: experiment?.specHash ?? null,
      status: experiment?.status ?? "draft",
      operation: experiment?.operation ?? null,
      lockedCandidateId: experiment?.lockedCandidateId ?? null,
      report: experiment?.report ?? null,
      progress: experiment?.progress ?? null,
      candidates: experiment?.candidates ?? [],
      scenarios: experiment?.scenarios ?? [],
      history: history.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
      })),
      acceptance: experiment?.report?.verdict ?? "INCONCLUSIVE",
      error: error || experiment?.error || null,
    },
    actions: {
      refresh: {
        description:
          "Read saved experiment history and refresh the selected experiment.",
        parameters: emptySchema,
        run: async () => {
          await refreshHistory();
          if (experiment) await open(experiment.id);
        },
      },
      open_experiment: {
        description: "Read an existing experiment and its frozen evidence.",
        parameters: {
          type: "object",
          properties: { id: { type: "string", maxLength: 100 } },
          required: ["id"],
          additionalProperties: false,
        },
        run: async ({ id }) => {
          if (!history.some((item) => item.id === id))
            throw new Error("Experiment is not in the saved history.");
          await open(String(id));
        },
      },
      select_candidate: {
        description:
          "Inspect a candidate without locking it or executing a trial.",
        parameters: {
          type: "object",
          properties: { id: { type: "string", maxLength: 100 } },
          required: ["id"],
          additionalProperties: false,
        },
        run: ({ id }) => {
          if (!experiment?.candidates.some((item) => item.id === id))
            throw new Error("Candidate not found.");
          setSelectedId(String(id));
        },
      },
    },
  });
  const selected = experiment?.candidates.find(
    (item) => item.id === selectedId,
  );
  const tunable = Object.keys(experiment?.searchSpace ?? {});
  const savedDraft = selected?.parameters ?? experiment?.parameters ?? {};
  const currentDraft = draft ?? Object.fromEntries(tunable.map((name) => [name, savedDraft[name]]));
  const capability = capabilities.find(
    (item) => item.engine === (experiment ? templates.find((item) => item.id === experiment.templateId)?.engine : template?.engine),
  );
  const canRun = Boolean(experiment && tunable.length && !busy && !running && !experiment.lockedCandidateId);
  return (
    <div className="control-lab" {...appObjectProps("control-lab")}>
      <header>
        <h1>Control Lab</h1>
        <span className="engine-status" role="status">
          {capability
            ? capability.available
              ? `${capability.engine} ${capability.version ?? "available"}`
              : `${capability.engine} unavailable`
            : "Engine status pending"}
        </span>
        <button disabled={!experiment || busy} onClick={() => experiment && void exportEvidence(experiment.id).catch(onError)}>Export</button>
        <button className="primary" disabled={!canRun} onClick={() => void runDraft().catch(onError)}>
          {running && experiment?.operation === "evaluate" ? "Running…" : "Run experiment"}
        </button>
        <button
          disabled={!experiment || busy}
          onClick={() =>
            void chat
              .compose(
                `Review Control Lab experiment ${experiment!.id}. Inspect the frozen specification and full verification denominator. Do not change the policy or claim engineering PASS from process success. Propose bounded candidates only.`,
                { attachments: [chat.objectReference("control-lab")], approveGoal: true },
              )
              .catch(onError)
          }
        >
          Approve goal and discuss
        </button>
        <button disabled={busy} onClick={newExperiment}>
          New experiment
        </button>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button
            onClick={() =>
              experiment ? void open(experiment.id) : void initialize()
            }
          >
            Retry loading
          </button>
        </div>
      )}
      <div className="layout">
        <aside>
          <details className="experiment-history">
          <summary>Experiments ({history.length})</summary>
          {loading ? (
            <p role="status">Loading templates and history…</p>
          ) : !history.length ? (
            <p className="muted">
              Freeze a specification to save your first experiment.
            </p>
          ) : (
            <ul className="history">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    disabled={busy}
                    title={item.id}
                    aria-current={experiment?.id === item.id}
                    onClick={(event) => {
                      const disclosure = event.currentTarget.closest("details");
                      if (disclosure) disclosure.open = false;
                      void open(item.id);
                    }}
                  >
                    {item.title}
                    <br />
                    <small>
                      {new Date(item.createdAt).toLocaleString()} —{" "}
                      {item.report?.verdict ?? item.status}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          </details>
          <details>
            <summary>Engine availability</summary>
            {capabilities.map((item) => (
              <p key={item.engine}>
                {item.engine}:{" "}
                {item.available ? (item.version ?? "Available") : "Unavailable"}
                {item.error && <span className="error"> {item.error}</span>}
              </p>
            ))}
          </details>
        </aside>
        <main aria-busy={loading || busy}>
          {!experiment ? (
            <section>
              <h2>Design specification</h2>
              <form
                onSubmit={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    event.target instanceof HTMLInputElement
                  ) {
                    event.preventDefault();
                    freezeSpecification(event.currentTarget);
                  }
                }}
              >
                <label>
                  Template
                  <select
                    aria-label="Template"
                    value={templateId}
                    disabled={loading || busy}
                    onChange={(event) => {
                      const item = templates.find(
                        (item) => item.id === event.target.value,
                      );
                      if (item) chooseTemplate(item);
                    }}
                  >
                    {templates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {template && (
                  <>

                    {capability && !capability.available && (
                      <p className="error">
                        {capability.engine} is unavailable. You can freeze this
                        specification, but execution needs the engine installed.{" "}
                        {capability.error}
                      </p>
                    )}
                    <fieldset disabled={busy}>
                      <legend>Plant and simulation</legend>
                      <Fields
                        fields={template.parameters}
                        values={parameters}
                        change={(name, value) =>
                          setParameters((prior) => ({
                            ...prior,
                            [name]: value,
                          }))
                        }
                      />
                    </fieldset>
                    <fieldset disabled={busy}>
                      <legend>Acceptance criteria</legend>
                      <Fields
                        fields={template.criteria}
                        values={criteria}
                        change={(name, value) =>
                          setCriteria((prior) => ({ ...prior, [name]: value }))
                        }
                      />
                    </fieldset>
                    <details>
                      <summary>
                        Frozen scenarios ({template.scenarios.length})
                      </summary>
                      <ul>
                        {template.scenarios.map((item) => (
                          <li key={item.id}>
                            {item.label} — {item.role}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <label>
                      Total candidate budget
                      <input
                        aria-label="Total candidate budget"
                        type="number"
                        required
                        min="1"
                        max="30"
                        step="1"
                        value={Number.isNaN(budget) ? "" : budget}
                        disabled={busy}
                        onChange={(event) =>
                          setBudget(event.target.valueAsNumber)
                        }
                      />
                    </label>
                    <p className="muted">Specification and policy are locked after freezing.</p>
                    <button
                      className="primary"
                      type="button"
                      onClick={(event) =>
                        freezeSpecification(event.currentTarget.form)
                      }
                      disabled={busy || loading}
                    >
                      {busy ? "Freezing…" : "Freeze specification"}
                    </button>
                  </>
                )}
              </form>
            </section>
          ) : (
            <>
              <section className="experiment-heading">
                <div><h2>{experiment.title}</h2>
                <span className="muted">Frozen specification: {experiment.status}
                  {experiment.operation && ` (${experiment.operation})`}
                </span></div>
                <div className="toolbar">
                  <button disabled={busy || running} onClick={() => void create(experiment).catch(onError)}>
                    Rerun as new experiment
                  </button>
                  <button
                    disabled={busy || running || !!experiment.lockedCandidateId}
                    onClick={() =>
                      void act("search", {
                        budget: experiment.candidateBudget,
                      }).catch(onError)
                    }
                  >
                    Run bounded search
                  </button>
                  {running && (
                    <button
                      disabled={busy}
                      onClick={() => void act("cancel").catch(onError)}
                    >
                      {experiment.operation === "verify"
                        ? "Cancel verification"
                        : experiment.operation === "evaluate"
                          ? "Cancel evaluation"
                          : "Cancel search"}
                    </button>
                  )}
                </div>
              </section>
              {experiment.error && <p className="error" role="alert">{experiment.error}</p>}
              <Results
                experiment={experiment}
                selectedId={selectedId}
                template={templates.find((item) => item.id === experiment.templateId)}
                draft={currentDraft}
                onDraft={(values) => setDraft({ ...currentDraft, ...values })}
                onSelect={selectCandidate}
              />
              <section className="candidate-actions">
                {running && (
                  <p role="status">
                    {experiment.operation === "verify"
                      ? "Verifying"
                      : experiment.operation === "evaluate"
                        ? "Evaluating proposal"
                        : "Searching"}
                    : {experiment.progress.completed} /{" "}
                    {experiment.progress.total} trials
                  </p>
                )}
                <div className="toolbar">
                  <button
                    disabled={
                      busy ||
                      running ||
                      !selected ||
                      !!experiment.lockedCandidateId
                    }
                    onClick={() =>
                      void act("lock", { candidateId: selectedId }).catch(
                        onError,
                      )
                    }
                  >
                    Lock candidate
                  </button>
                  <button
                    className="primary"
                    disabled={busy || running || !experiment.lockedCandidateId}
                    onClick={() => void act("verify").catch(onError)}
                  >
                    Verify locked candidate
                  </button>
                  <button
                    disabled={busy || running || !experiment.report}
                    onClick={() => void act("reevaluate").catch(onError)}
                  >
                    Re-evaluate evidence
                  </button>
                </div>
                <p className="muted">
                  Locking a candidate is permanent.
                </p>
              </section>
              <Evidence experiment={experiment} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
