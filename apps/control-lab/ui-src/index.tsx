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
import { numeric } from "./presentation";
import { Results } from "./results";
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
  const [budget, setBudget] = useState(8),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selection = useRef(0),
    pending = useRef(false);
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
      }
      await refreshHistory();
      return result;
    } finally {
      pending.current = false;
      setBusy(false);
    }
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
    setError("");
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
  const capability = capabilities.find(
    (item) => item.engine === template?.engine,
  );
  return (
    <div {...appObjectProps("control-lab")}>
      <header>
        <h1>Control Lab</h1>
        <button
          onClick={() =>
            void chat
              .compose(
                experiment
                  ? `Review Control Lab experiment ${experiment.id}. Inspect the frozen specification and full verification denominator. Do not change the policy or claim engineering PASS from process success. Propose bounded candidates only.`
                  : "Help me choose a Control Lab specification for controller or second-order active-filter design.",
                { attachments: [chat.objectReference("control-lab")] },
              )
              .catch(onError)
          }
        >
          Discuss in chat
        </button>
        <button disabled={busy} onClick={newExperiment}>
          New experiment
        </button>
      </header>
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
          <h2>Experiments</h2>
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
                    onClick={() => void open(item.id)}
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
                    <p>{template.description}</p>
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
                    <p className="muted">
                      Freezing saves an immutable specification and verification
                      policy. Changes require a new experiment.
                    </p>
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
              <section>
                <h2>{experiment.title}</h2>
                <p>
                  <strong>Frozen specification</strong> — {experiment.status}
                  {experiment.operation && ` (${experiment.operation})`}
                </p>
                <details>
                  <summary>Specification and policy</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        specHash: experiment.specHash,
                        candidateBudget: experiment.candidateBudget,
                        parameters: experiment.parameters,
                        criteria: experiment.criteria,
                        scenarios: experiment.scenarios,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                {experiment.error && (
                  <p className="error" role="alert">
                    {experiment.error}
                  </p>
                )}
                <div className="toolbar">
                  <button
                    disabled={busy || running}
                    onClick={() => void create(experiment).catch(onError)}
                  >
                    Rerun as new experiment
                  </button>
                  <button
                    onClick={() =>
                      void api
                        .get<unknown>(
                          `/api/experiments/${encodeURIComponent(experiment.id)}/export`,
                        )
                        .then((evidence) =>
                          downloadFile(
                            `control-lab-${experiment.id}.json`,
                            JSON.stringify(evidence, null, 2),
                            "application/json",
                          ),
                        )
                        .catch(onError)
                    }
                  >
                    Export evidence
                  </button>
                </div>
              </section>
              <section>
                <h2>Candidate search</h2>
                <p className="muted">
                  Built-in search is deterministic. Agent proposals are
                  evaluated under the same frozen policy. The total budget
                  includes the baseline and all attempted candidates.
                </p>
                <div className="toolbar">
                  <p>
                    Frozen total candidate budget: {experiment.candidateBudget}
                  </p>
                  <button
                    className="primary"
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
                {running && (
                  <p role="status">
                    {experiment.operation === "verify"
                      ? "Verifying"
                      : experiment.operation === "evaluate"
                        ? "Evaluating proposal"
                        : "Searching"}
                    : {experiment.progress.completed} /{" "}
                    {experiment.progress.total} trials recorded. Results and
                    failures remain visible.
                  </p>
                )}
                {experiment.candidates.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Candidate</th>
                          <th>Parameters</th>
                          <th>Search score</th>
                          <th>Search verdict</th>
                        </tr>
                      </thead>
                      <tbody>
                        {experiment.candidates.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <label>
                                <input
                                  type="radio"
                                  name="candidate"
                                  checked={selectedId === item.id}
                                  onChange={() => setSelectedId(item.id)}
                                />
                                {item.label}
                                {experiment.lockedCandidateId === item.id &&
                                  " (locked)"}
                              </label>
                            </td>
                            <td>
                              {Object.entries(item.parameters)
                                .map(
                                  ([name, value]) =>
                                    `${name} = ${numeric(value)}`,
                                )
                                .join(", ")}
                            </td>
                            <td>{numeric(item.score)}</td>
                            <td className={`status ${item.verdict}`}>
                              {item.verdict}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>
                    No candidates yet. Run the bounded search to evaluate the
                    baseline and candidates.
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
                  Locking is permanent for this experiment. Final verification
                  runs the frozen scenarios separately from search.
                </p>
              </section>
              <Results experiment={experiment} selectedId={selectedId} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
