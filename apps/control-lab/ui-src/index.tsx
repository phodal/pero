import { AppBar, Button, Feedback, Select, Progress } from '@pero/app-sdk/ui';
import React, { useCallback, useEffect, useRef, useState } from "react";
import { EnvironmentInspector } from "@pero/app-sdk/ui";
import {
  appObjectProps,
  downloadFile,
  useAppAgent,
  useAppApi,
  useAppChat,
  useAppDataChanged,
  useAppObject,
} from "@pero/app-sdk";
import { AppApiError } from "@pero/app-sdk/core";
import type { Capability, Experiment, Summary, Template } from "./types";
import { applyTranscriptDraft, draftRangeError, generationPrompt, matchingCandidate, parseGeneratedDraft, unsavedExperiment } from "./presentation";
import { Specification } from "./specification";
import { Results, Evidence } from "./results";
import "./styles.css";
const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
const generatedDraftSchema = {
  type: "object",
  properties: {
    parameters: { type: "object", additionalProperties: true },
    criteria: { type: "object", additionalProperties: true },
    candidateBudget: { type: "number" },
  },
  additionalProperties: true,
};
export default function ControlLab() {
  const api = useAppApi(),
    chat = useAppChat(),
    agent = useAppAgent();
  const [templates, setTemplates] = useState<Template[]>([]),
    [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [history, setHistory] = useState<Summary[]>([]),
    [templateId, setTemplateId] = useState("");
  const [parameters, setParameters] = useState<Record<string, number>>({}),
    [criteria, setCriteria] = useState<Record<string, number>>({});
  const [experiment, setExperiment] = useState<Experiment | null>(null),
    [selectedId, setSelectedId] = useState("baseline");
  const [linkedTrial, setLinkedTrial] = useState<{ id: string; request: number } | null>(null);
  const [budget, setBudget] = useState(6),
    [loading, setLoading] = useState(true),
    [mutating, setMutating] = useState(false),
    [opening, setOpening] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [refreshError, setRefreshError] = useState(""),
    [cancelRequested, setCancelRequested] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [draftError, setDraftError] = useState(""),
    [generating, setGenerating] = useState(false),
    [draft, setDraft] = useState<Record<string, number> | null>(null);
  const busy = mutating || opening;
  const templateInitialized = useRef(false);
  const selection = useRef(0),
    readRequest = useRef(0),
    historyRequest = useRef(0),
    targetId = useRef<string | null>(null),
    pending = useRef(false),
    pendingSelect = useRef<Record<string, number> | null>(null),
    generationToken = useRef(0),
    generationSession = useRef(""),
    draftApplied = useRef(false),
    draftFailure = useRef(""),
    experimentNow = useRef(experiment),
    specForm = useRef<HTMLFormElement>(null);
  experimentNow.current = experiment;
  const template = templates.find((item) => item.id === templateId),
    running = experiment?.status === "running";
  const onError = (value: unknown) =>
    setError(value instanceof Error ? value.message : String(value));
  const refreshHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    const result = await api.get<{ experiments: Summary[] }>(
      "/api/experiments",
    );
    if (request === historyRequest.current) setHistory(result.experiments);
  }, [api]);
  function chooseTemplate(item: Template) {
    setBudget(item.defaultCandidateBudget);
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
      if (data.templates[0] && !templateInitialized.current) { chooseTemplate(data.templates[0]); templateInitialized.current = true; }
      await refreshHistory();
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [api, refreshHistory]);
  useEffect(() => {
    void initialize();
    return () => { selection.current++; readRequest.current++; historyRequest.current++; };
  }, [initialize]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:location' || typeof event.data.location !== 'string') return;
      const match = /^experiment\/([a-f0-9]{32})(?:\/trial\/([a-f0-9]{32}))?$/.exec(event.data.location);
      if (match) void open(match[1], match[2]);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [api]);
  function invalidateUnavailable(error: unknown) {
    if (error instanceof AppApiError && [401, 403, 404, 410].includes(error.status)) {
      // Revoked access or a removed source also invalidates pending responses.
      selection.current++;
      readRequest.current++;
      setOpening(false);
      setRefreshing(false);
      setExperiment(null);
      setDraft(null);
      pendingSelect.current = null;
      setCancelRequested(false);
      setRefreshError("");
      setError(`This experiment is unavailable. ${error.message}`);
      return true;
    }
    return false;
  }
  function readFailed(error: unknown) {
    if (invalidateUnavailable(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    if (experimentNow.current?.id === targetId.current) setRefreshError(message);
    else setError(message);
  }
  async function open(id: string, trialId?: string) {
    const sameObject = experimentNow.current?.id === id;
    const revision = targetId.current === id ? selection.current : ++selection.current;
    targetId.current = id;
    const request = ++readRequest.current;
    if (sameObject) setRefreshing(true);
    else { setExperiment(null); setLinkedTrial(null); setOpening(true); setRefreshing(false); }
    setRefreshError("");
    setError("");
    try {
      const result = await api.get<Experiment>(
        `/api/experiments/${encodeURIComponent(id)}`,
      );
      if (revision === selection.current && request === readRequest.current) {
        const trial = trialId ? result.trials.find(item => item.id === trialId) : undefined;
        if (trialId && !trial?.report) throw new Error("The requested trial report is unavailable.");
        setExperiment(result);
        if (!sameObject) {
          setCancelRequested(false);
          setSelectedId(result.lockedCandidateId ?? result.candidates.at(-1)?.id ?? "baseline");
          setDraft(null);
          pendingSelect.current = null;
          setBudget(result.candidateBudget);
        }
        if (trial) setLinkedTrial({ id: trial.id, request });
      }
    } catch (error) {
      if (revision === selection.current && request === readRequest.current) readFailed(error);
    } finally {
      if (revision === selection.current && request === readRequest.current) { setOpening(false); setRefreshing(false); }
    }
  }
  async function refresh() {
    const revision = selection.current;
    try {
      await refreshHistory();
      if (revision === selection.current && targetId.current) await open(targetId.current);
    } catch (error) {
      if (revision === selection.current) onError(error);
    }
  }
  useAppDataChanged(refresh);
  useEffect(() => {
    if (!experiment || !running) return;
    const id = experiment.id, revision = selection.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (pending.current) { timer = setTimeout(poll, 600); return; }
      const request = ++readRequest.current;
      let delay = 600;
      try {
        const next = await api.get<Experiment>(`/api/experiments/${encodeURIComponent(id)}`);
        if (disposed || revision !== selection.current) return;
        if (request === readRequest.current) {
          setExperiment(next);
          setRefreshError("");
          setRefreshing(false);
          if (next.status !== "running") {
            void refreshHistory().catch(error => { if (revision === selection.current) onError(error); });
            return;
          }
        }
      } catch (error) {
        if (disposed || revision !== selection.current) return;
        if (request === readRequest.current) { readFailed(error); setRefreshing(false); }
        delay = 2000;
      }
      if (!disposed && revision === selection.current) timer = setTimeout(poll, delay);
    }
    timer = setTimeout(poll, 300);
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, experiment?.id, running, refreshHistory]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2700);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!experiment || busy || experiment.status === "running" || !pendingSelect.current) return;
    const names = Object.keys(experiment.searchSpace);
    const observed = experiment.candidates.filter(candidate => experiment.trials.some(trial => trial.phase === "search" && trial.candidateId === candidate.id));
    const match = matchingCandidate(observed.reverse(), pendingSelect.current, names);
    if (!match && !experiment.error) return;
    pendingSelect.current = null;
    if (match) { setSelectedId(match.id); setDraft(null); }
  }, [experiment, busy]);
  async function create(source?: Experiment) {
    if (pending.current) throw new Error("An operation is already pending.");
    pending.current = true;
    readRequest.current++;
    setRefreshing(false);
    const revision = selection.current;
    setMutating(true);
    setError("");
    try {
      const result = await api.post<Experiment>("/api/experiments", {
        templateId: source?.templateId ?? templateId,
        parameters: source?.parameters ?? parameters,
        criteria: source?.criteria ?? criteria,
        candidateBudget: source?.candidateBudget ?? budget,
      });
      if (revision !== selection.current) return;
      readRequest.current++;
      setRefreshing(false);
      targetId.current = result.id;
      setExperiment(result);
      setSelectedId("baseline");
      setDraft(null);
      await refreshHistory();
      return result;
    } catch (error) {
      if (revision === selection.current && !invalidateUnavailable(error)) throw error;
    } finally {
      pending.current = false;
      setMutating(false);
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
    if (loading || busy || generating || pending.current || !form?.reportValidity()) return;
    void create().catch(onError);
  }
  useEffect(() => { if (!running) setCancelRequested(false); }, [running]);
  async function act(action: string, body: object = {}) {
    if (!experiment) throw new Error("Freeze a specification first.");
    if (pending.current) throw new Error("An operation is already pending.");
    pending.current = true;
    readRequest.current++;
    setRefreshing(false);
    const revision = selection.current;
    const id = experiment.id;
    if (action === "cancel") setCancelRequested(true);
    setMutating(true);
    setError("");
    try {
      const result = await api.post<Experiment>(
        `/api/experiments/${encodeURIComponent(id)}/${action}`,
        body,
      );
      if (revision === selection.current) { readRequest.current++; setRefreshing(false); setExperiment(result); }
      await refreshHistory();
      return result;
    } catch (error) {
      if (revision !== selection.current) return;
      if (action === "cancel") setCancelRequested(false);
      if (!invalidateUnavailable(error)) throw error;
    } finally {
      pending.current = false;
      setMutating(false);
    }
  }
  function newExperiment() {
    if (pending.current) return;
    selection.current++;
    readRequest.current++;
    targetId.current = null;
    setOpening(false);
    setRefreshing(false);
    setExperiment(null);
    setRefreshError("");
    setCancelRequested(false);
    if (template) chooseTemplate(template);
    setDraft(null);
    pendingSelect.current = null;
    setError("");
  }
  function cancelGeneration() {
    generationToken.current += 1;
    const id = generationSession.current;
    generationSession.current = "";
    setGenerating(false);
    setDraftError("Generation cancelled.");
    if (id && id !== "pending") void agent.cancel({ sessionId: id }).catch(() => {});
  }
  async function generateParameters() {
    if (!template || experiment || generating || generationSession.current) return;
    const token = ++generationToken.current;
    generationSession.current = "pending";
    const prompt = generationPrompt(template, parameters, criteria, budget);
    draftApplied.current = false;
    draftFailure.current = "";
    setDraftError("");
    setGenerating(true);
    try {
      const info = await agent.refresh();
      if (token !== generationToken.current) return;
      const agentId = info.agents.find((item) => item.available)?.id;
      if (!info.available || !agentId) throw new Error("No model is available.");
      const started = await agent.start({
        requestId: crypto.randomUUID(),
        prompt,
        agentId,
      });
      if (token !== generationToken.current) {
        void agent.cancel({ sessionId: started.sessionId }).catch(() => {});
        return;
      }
      generationSession.current = started.sessionId;
      let cursor = 0;
      let status = "running";
      let reply = "";
      for (let attempt = 0; attempt < 60 && status === "running" && token === generationToken.current; attempt++) {
        const transcript = await agent.events({ sessionId: started.sessionId, after: cursor });
        if (token !== generationToken.current) return;
        cursor = transcript.cursor;
        reply = transcript.text;
        if (draftApplied.current) break;
        status = transcript.status;
        if (status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (token !== generationToken.current) return;
      if (status === "cancelled") throw new Error("Generation cancelled.");
      if (status === "needs_input") throw new Error("No model is available.");
      if (draftApplied.current) return;
      if (status !== "completed") throw new Error(draftFailure.current || "The host did not return a validated draft.");
      const next = applyTranscriptDraft(
        { parameters, criteria, budget },
        template,
        reply,
        experimentNow.current != null,
      );
      if (next.error) throw new Error(next.error);
      setParameters(next.parameters);
      setCriteria(next.criteria);
      setBudget(next.budget);
      setDraftError("");
    } catch (caught) {
      if (token === generationToken.current)
        setDraftError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (token === generationToken.current) {
        const id = generationSession.current;
        generationSession.current = "";
        setGenerating(false);
        if (id && id !== "pending") void agent.cancel({ sessionId: id }).catch(() => {});
      }
    }
  }
  function selectCandidate(id: string) {
    setSelectedId(id);
    setDraft(null);
  }
  async function runSaved(current: Experiment, proposed: Record<string, number>) {
    if (pending.current) throw new Error("An operation is already pending.");
    pending.current = true;
    readRequest.current++;
    setRefreshing(false);
    const revision = selection.current;
    setMutating(true);
    setError("");
    try {
      const result = await api.post<Experiment>(
        `/api/experiments/${encodeURIComponent(current.id)}/propose`,
        { parameters: proposed },
      );
      if (revision === selection.current) { readRequest.current++; setRefreshing(false); setExperiment(result); }
      await refreshHistory();
    } catch (error) {
      if (revision === selection.current && !invalidateUnavailable(error)) throw error;
    } finally {
      pending.current = false;
      setMutating(false);
    }
  }
  async function runDraft() {
    let current = experiment;
    let proposed = currentDraft;
    if (!current) {
      current = (await create()) ?? null;
      if (!current) return;
      const names = Object.keys(current.searchSpace);
      proposed = Object.fromEntries(names.map((name) => [name, current!.parameters[name]]));
    }
    const names = Object.keys(current.searchSpace);
    const parameters = Object.fromEntries(names.map((name) => [name, proposed[name]]));
    const problem = draftRangeError(parameters, current.searchSpace);
    if (problem) {
      setError(problem);
      setNotice(problem);
      return;
    }
    const existing = matchingCandidate(current.candidates.filter(candidate => current.trials.some(trial => trial.phase === "search" && trial.candidateId === candidate.id)).reverse(), parameters, names);
    if (existing) {
      setSelectedId(existing.id);
      setDraft(null);
      setError("");
      setNotice("Matching candidate selected");
      return;
    }
    setError("");
    pendingSelect.current = parameters;
    try {
      if (experiment) await act("propose", { parameters });
      else await runSaved(current, parameters);
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
      refreshing,
      refreshError: refreshError || null,
      generating,
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
        run: refresh,
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
      ...(template && !experiment
        ? {
            apply_generated_draft: {
              description:
                `Replace the unsaved design draft for the selected template. parameters and criteria use only that template's fields. candidateBudget is an optional integer from 1 to ${template.candidateBudgetMax}. Does not freeze, search, propose, or accept scenarios, a spec hash, or an engine name.`,
              parameters: generatedDraftSchema,
              run: (params: Record<string, unknown>) => {
                if (experiment) throw new Error("A frozen experiment cannot accept a generated draft.");
                try {
                  const next = parseGeneratedDraft(template, params);
                  setParameters(next.parameters);
                  setCriteria(next.criteria);
                  if (next.budget != null) setBudget(next.budget);
                  draftApplied.current = true;
                  draftFailure.current = "";
                  setDraftError("");
                } catch (caught) {
                  const message = caught instanceof Error ? caught.message : String(caught);
                  draftFailure.current = message;
                  setDraftError(message);
                  throw caught instanceof Error ? caught : new Error(message);
                }
              },
            },
          }
        : {}),
    },
  });
  const selected = experiment?.candidates.find(
    (item) => item.id === selectedId,
  );
  const preview = !experiment && !targetId.current && template ? unsavedExperiment(template, parameters, criteria, budget) : null;
  const tunable = Object.keys(experiment?.searchSpace ?? preview?.searchSpace ?? {});
  const savedDraft = selected?.parameters ?? experiment?.parameters ?? {};
  const currentDraft = draft ?? Object.fromEntries(tunable.map((name) => [name, savedDraft[name]]));
  const capability = capabilities.find(
    (item) => item.engine === (experiment ? templates.find((item) => item.id === experiment.templateId)?.engine : template?.engine),
  );
  const canRun = Boolean((experiment || preview) && tunable.length && capability?.available && !busy && !generating && !running && !experiment?.lockedCandidateId);
  const candidateLocked = Boolean(experiment?.lockedCandidateId);
  const runSpecification = () => {
    if (!experiment && specForm.current && !specForm.current.reportValidity()) return;
    void runDraft().catch(onError);
  };
  const runButton = <Button variant={canRun ? "primary" : "ghost"} disabled={!canRun} aria-describedby="run-specification-effect" onClick={runSpecification}>Run experiment</Button>;
  const newButton = <Button variant={canRun ? "ghost" : "primary"} disabled={busy || generating} onClick={newExperiment}>New experiment</Button>;
  return (
    <div className="control-lab" {...appObjectProps("control-lab")}>
      {!experiment && <h1 className="pero-visually-hidden">Control Lab</h1>}
      <AppBar title={experiment?.title} scope={<>
        {!experiment && <Select label="Template" value={templateId} disabled={loading || busy || generating}
          options={templates.map(item => ({ value: item.id, label: item.title }))}
          onChange={value => { const item = templates.find(item => item.id === value); if (item) chooseTemplate(item); }}/>}
        {!!history.length && <Select label="Open experiment" triggerLabel="Open experiment" value={targetId.current ?? ''} disabled={busy || generating}
          options={[{ value: '', label: 'New draft' }, ...history.map(item => ({ value: item.id, label: item.title,
            hint: `${new Date(item.createdAt).toLocaleString()} · ${item.report?.verdict ?? item.status}` }))]}
          showHint onChange={value => value ? void open(value) : newExperiment()}/>}
      </>} utilities={capability?.available ? <span title={`${capability.engine} ${capability.version ?? 'available'}`}><EnvironmentInspector targets={[capability.engine === 'ngspice' ? 'control-lab.ngspice' : 'control-lab.python-control']} /></span> : undefined}
      commands={<>
        {experiment && <Button variant="ghost" disabled={busy} onClick={() => void exportEvidence(experiment.id).catch(onError)}>Export</Button>}
        {experiment && <Button variant="ghost" disabled={busy} onClick={() =>
          void chat.compose(
            `Review Control Lab experiment ${experiment!.id}. Inspect the frozen specification and full verification denominator. Do not change the policy or claim engineering PASS from process success. Propose bounded candidates only.`,
            { attachments: [chat.objectReference("control-lab")], approveGoal: true },
          ).catch(onError)}>Approve goal and discuss</Button>}
        {experiment && <Button variant="ghost" disabled={busy || running} onClick={() => void create(experiment).catch(onError)}>Duplicate settings</Button>}
        {!experiment && preview && template && <Button variant="ghost" disabled={loading || busy || generating} onClick={() => freezeSpecification(specForm.current)}>Freeze specification</Button>}
        {canRun ? newButton : runButton}
      </>} primary={canRun ? runButton : newButton}/>
      {notice && <Feedback kind="info" variant="block">{notice}</Feedback>}
      {draftError && <Feedback kind="error" variant="block">{draftError}</Feedback>}
      {error && (
        <Feedback kind="error" variant="block">
          {error}{" "}
          <Button
            onClick={() =>
              targetId.current ? void open(targetId.current) : void initialize()
            }
          >
            Retry loading
          </Button>
        </Feedback>
      )}
      <div className="layout">
        <main aria-busy={loading || busy || generating}>
          {capability && !capability.available && <div className="environment-notice">
            <Feedback kind="warning" variant="block">{capability.engine} is unavailable. {capability.error}</Feedback>
            <EnvironmentInspector targets={[capability.engine === 'ngspice' ? 'control-lab.ngspice' : 'control-lab.python-control']}/>
          </div>}
          {loading && <Feedback>Loading templates and history…</Feedback>}
          {busy && targetId.current && !experiment && <Feedback>Loading this experiment…</Feedback>}
          {refreshing && <Feedback>Updating this experiment…</Feedback>}
          {refreshError && <Feedback kind="warning" variant="block">Could not refresh this experiment. Showing the last loaded evidence. {refreshError}<Button onClick={() => experiment && void open(experiment.id)}>Retry refresh</Button></Feedback>}
          {!experiment ? (preview && template && <Results
            experiment={preview} selectedId="baseline" template={template} draft={parameters}
            disabled={loading || busy || generating} onDraft={values => setParameters(prior => ({ ...prior, ...values }))} onSelect={() => {}}
            setup={<Specification template={template} tunable={tunable} parameters={parameters} criteria={criteria} budget={budget}
              disabled={loading || busy || generating} generating={generating} formRef={specForm}
              onParameter={(name, value) => setParameters(prior => ({ ...prior, [name]: value }))}
              onCriterion={(name, value) => setCriteria(prior => ({ ...prior, [name]: value }))}
              onBudget={setBudget} onGenerate={() => void generateParameters()} onCancel={cancelGeneration} onFreeze={freezeSpecification}/>} />
          ) : (
            <>
              {(running || !candidateLocked || experiment.status === "cancelled") && <section className="experiment-heading" aria-label="Experiment execution">
                {running ? <>
                  <div className="trial-progress">
                    <span role="status">
                      {cancelRequested ? "Cancelling" : experiment.operation === "verify"
                        ? "Verifying" : experiment.operation === "evaluate"
                          ? "Evaluating proposal" : "Searching"} · {experiment.progress.completed} / {experiment.progress.total} trials
                    </span>
                    <Progress label="Completed trials" value={experiment.progress.completed} max={Math.max(1, experiment.progress.total)} />
                  </div>
                  <Button disabled={busy || cancelRequested} onClick={() => void act("cancel").catch(onError)}>
                    {experiment.operation === "verify" ? "Cancel verification" : experiment.operation === "evaluate" ? "Cancel evaluation" : "Cancel search"}
                  </Button>
                </> : <div className="toolbar">
                  {experiment.status === "cancelled" && <span role="status">Run cancelled</span>}
                  {!candidateLocked && <Button variant="ghost" disabled={busy} onClick={() => void act("search", { budget: experiment.candidateBudget }).catch(onError)}>Run bounded search</Button>}
                </div>}
              </section>}
              {experiment.error && <Feedback kind="error" variant="block">{experiment.error}</Feedback>}
              <Results
                key={`results-${experiment.id}`}
                experiment={experiment}
                disabled={busy || running || !!experiment.lockedCandidateId}
                selectedId={selectedId}
                template={templates.find((item) => item.id === experiment.templateId)}
                draft={currentDraft}
                onDraft={(values) => setDraft({ ...currentDraft, ...values })}
                onSelect={selectCandidate}
                candidateActions={!running && (candidateLocked || selected) && <div className="candidate-actions">
                  <div className="toolbar">
                    {candidateLocked ? <>
                      <Button variant="primary" disabled={busy} onClick={() => void act("verify").catch(onError)}>
                        {experiment.report ? "Verify again" : "Verify locked candidate"}
                      </Button>
                      {experiment.report && <Button disabled={busy} onClick={() => void act("reevaluate").catch(onError)}>
                        Re-evaluate evidence
                      </Button>}
                    </> : <Button variant="primary" aria-describedby="lock-candidate-effect" disabled={busy}
                      onClick={() => void act("lock", { candidateId: selectedId }).catch(onError)}>
                      Lock candidate
                    </Button>}
                  </div>
                  {!candidateLocked && <p className="muted" id="lock-candidate-effect">Locking a candidate is permanent.</p>}
                </div>}
              />
              <Evidence key={`evidence-${experiment.id}-${linkedTrial?.request ?? 0}`} experiment={experiment} linkedTrialId={linkedTrial?.id} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
