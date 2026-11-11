/* Generated from protocol/host.tsp by scripts/codegen/contracts.mjs. Do not edit. */
import type { AppDocumentSchema, AppName, PreparationFailure, RequestId } from './host';

export type LocalEnvironmentOperation =
  | LocalEnvironmentCreate
  | LocalEnvironmentList
  | LocalEnvironmentPrepare
  | LocalEnvironmentCancel
  | LocalEnvironmentBind
  | LocalEnvironmentCreateLockedControl
  | LocalEnvironmentCreateLocked
  | LocalEnvironmentRebuild
  | LocalEnvironmentBindCompute
  | LocalEnvironmentUnbindCompute;
export interface LocalEnvironmentApp {
  action: "localenvironment";
  name: AppName;
  request: LocalEnvironmentOperation;
  method: "apps";
  id: RequestId;
}
export interface LocalEnvironmentCreate {
  operation: "create";
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice" | "lcms2yield.inference";
  label: string;
}
export interface LocalEnvironmentList {
  operation: "list";
  compute?: boolean;
}
export interface LocalEnvironmentPrepare {
  operation: "prepare";
  id: AppName;
}
export interface LocalEnvironmentCancel {
  operation: "cancel";
  id: AppName;
}
export interface LocalEnvironmentBind {
  operation: "bind";
  id: AppName;
}
export interface LocalEnvironmentCreateLockedControl {
  operation: "create_locked_control";
  label: string;
}
export interface LocalEnvironmentCreateLocked {
  operation: "create_locked";
  target: "paper-agent.pcgym" | "control-lab.python-control";
  label: string;
}
export interface LocalEnvironmentRebuild {
  operation: "rebuild";
  id: AppName;
  label: string;
}
export interface LocalEnvironmentBindCompute {
  operation: "bind_compute";
  id: AppName;
}
export interface LocalEnvironmentUnbindCompute {
  operation: "unbind_compute";
  target?: "paper-agent.pcgym" | "control-lab.python-control";
}
/**
 * Software observations only; does not allocate or approve scientific execution.
 */
export interface EnvironmentInspectionApp {
  action: "environment";
  name: AppName;
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice" | "lcms2yield.inference";
  method: "apps";
  id: RequestId;
}
export interface LocalEnvironmentRecord {
  failure?: PreparationFailure | null;
  locked_compute?: boolean;
  prepared?: LockedPythonProfile | null;
  id: AppName;
  label: string;
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice" | "lcms2yield.inference";
  dependencies: string[];
  state: "created" | "preparing" | "ready" | "failed";
  log: string[];
  error: string | null;
  bound: boolean;
}
export interface LockedPythonProfile {
  root: string;
  project_sha256: string;
  lock_sha256: string;
  python_request: string;
  python_archive_url: string;
  python_archive_sha256: string;
  uv_version: string;
  uv_sha256: string;
  observation: PythonComputeObservation;
}
export interface PythonComputeObservation {
  version: string;
  build: string;
  platform: string;
  machine: string;
  executable_sha256: string;
  packages: ComputePackages;
  packages_sha256: string;
}
export interface ComputePackages {
  [k: string]: string | undefined;
}
export interface EnvironmentInspectionReport {
  schema: "pero.environment.inspection.v1";
  method: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice" | "lcms2yield.inference";
  scope: "configured-interpreter";
  evidence: "metadata_only";
  observed_at_ms: string;
  profile: AppDocumentSchema;
  requirements: AppDocumentSchema;
  matched: boolean;
  missing: AppDocumentSchema[];
}
