export type Value = string | number | boolean | null;

export type Benchmark = {
  id: string;
  name: string;
  version: string;
  description: string;
  executionKind: string;
  available: boolean;
  unavailableReason: string | null;
  specDigest: string;
  environment: Record<string, Value>;
  parameters: Record<string, Value>;
  criteria: Record<string, Value>;
};

export type Verification = {
  schemaVersion: 1;
  status: "pass" | "fail" | "incomplete";
  metrics: Record<string, Value>;
  thresholds: Record<string, Value>;
  errors: string[];
  checks?: { id: string; label: string; passed: boolean; value: Value; threshold: Value | number[] }[];
};

export type Run = {
  id: string;
  benchmarkId: string;
  benchmarkName: string;
  specDigest: string;
  executionKind: "local-reference";
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  operation: "run" | "verify" | null;
  createdAt: string;
  updatedAt: string;
  reframeVersion: string | null;
  elapsedSeconds: number | null;
  exitCode: number | null;
  verification: Verification | null;
  error: string | null;
  artifacts: { name: string; bytes: number; sha256: string }[];
  logs: string;
};

export type Runtime = {
  mode: "local-reference";
  reframeAvailable: boolean;
  reframeVersion: string | null;
  requiredReframeVersion: string;
  message: string;
  capabilities: { id: string; available: boolean; reason: string }[];
};

export type State = { benchmarks: Benchmark[]; runs: Run[]; runtime: Runtime };

export type Comparison = {
  runIds: string[];
  comparable: boolean;
  specDigest: string | null;
  reason: string;
  rows: {
    runId: string;
    status: Run["status"];
    verificationStatus: string;
    elapsedSeconds: number | null;
    metrics: Record<string, Value>;
  }[];
};
