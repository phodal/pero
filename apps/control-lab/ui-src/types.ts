export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_RUN";
export type Field = {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
};
export type Scenario = {
  id: string;
  label: string;
  role: "search" | "verification";
  parameters: Record<string, number>;
};
export type Template = {
  id: string;
  title: string;
  description: string;
  engine: string;
  parameters: Field[];
  criteria: Field[];
  scenarios: Scenario[];
};
export type Capability = {
  engine: string;
  available: boolean;
  version: string | null;
  error: string | null;
};
export type Check = {
  name: string;
  verdict: Verdict;
  actual: number | null;
  limit: number | null;
  message: string;
};
export type Report = {
  id: string;
  verdict: Verdict;
  checks: Check[];
  evidence: string[];
  candidateId?: string;
};
export type Series = {
  name: string;
  unit: string;
  xUnit?: string;
  x: number[];
  y: number[];
};
export type Observation = {
  id: string;
  engine: string;
  engineVersion: string;
  internalStable: boolean | null;
  series: Series[];
  metrics: Record<string, number | number[] | { real: number; imag: number }[]>;
  artifacts: { name: string; sha256: string }[];
  diagnostics: string[];
};
export type Trial = {
  id: string;
  candidateId: string;
  scenarioId: string;
  phase: "search" | "verification";
  operationId?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  observation: Observation | null;
  report: Report | null;
};
export type Candidate = {
  id: string;
  label: string;
  parameters: Record<string, number>;
  score: number | null;
  verdict: Verdict;
};
export type Experiment = {
  id: string;
  templateId: string;
  title: string;
  createdAt: string;
  specHash: string;
  candidateBudget: number;
  parameters: Record<string, number>;
  criteria: Record<string, number>;
  scenarios: Scenario[];
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  operation: null | "search" | "verify" | "evaluate";
  progress: { completed: number; total: number };
  error: string | null;
  candidates: Candidate[];
  lockedCandidateId: string | null;
  verificationOperationId?: string | null;
  trials: Trial[];
  report: Report | null;
  limitations: string[];
};
export type Summary = Pick<
  Experiment,
  | "id"
  | "title"
  | "templateId"
  | "createdAt"
  | "status"
  | "report"
  | "lockedCandidateId"
>;
