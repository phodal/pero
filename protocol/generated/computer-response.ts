/* Generated from protocol/computer-runtime.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/computer-runtime.tsp. Do not edit.
 */
export type ComputerResponseContract =
  ComputerWorkerResponse | ComputerUseState | ComputerSettingsEvent | ComputerSettingsErrorEvent | ComputerStateEvent;
export type ComputerWorkerResponse = ComputerWorkerSuccess | ComputerWorkerFailure;
/**
 * Host-issued references, never OS handles, paths, credentials or caller identities.
 */
export type ComputerRef = string;
export type ComputerResponse =
  | ComputerStatusResponse
  | ComputerTargetsResponse
  | ComputerOpenedResponse
  | ComputerObservationResponse
  | ComputerReceiptResponse
  | ComputerStoppedResponse;
export type ComputerPermissionState = "granted" | "not_detected" | "unsupported";
export type ComputerObservationKind = "accessibility" | "screenshot";
export type ComputerActionKind = "click" | "type_text" | "press_key" | "scroll" | "drag";
export type ComputerDelivery = "background" | "foreground";
export type ComputerDimension = number;
export type ComputerActionOutcome = ComputerExecuted | ComputerRejected | ComputerUnknown;
export type ComputerErrorCode =
  | "unsupported"
  | "permission_required"
  | "target_unavailable"
  | "stale_observation"
  | "invalid_request"
  | "cancelled"
  | "timeout"
  | "failed";

export interface ComputerWorkerSuccess {
  id: ComputerRef;
  value: ComputerResponse;
}
export interface ComputerStatusResponse {
  kind: "status";
  status: ComputerDriverStatus;
}
export interface ComputerDriverStatus {
  available: boolean;
  accessibility: ComputerPermissionState;
  screen_recording: ComputerPermissionState;
  message: string;
}
export interface ComputerTargetsResponse {
  kind: "targets";
  capabilities: ComputerCapabilities;
  targets: ComputerTarget[];
}
export interface ComputerCapabilities {
  protocol: "pero.computer-use.v1";
  runtime_id: ComputerRef;
  observations: ComputerObservationKind[];
  actions: ComputerActionSupport[];
}
/**
 * One supported action/delivery pair. Adapters may still refuse a particular target.
 */
export interface ComputerActionSupport {
  action: ComputerActionKind;
  delivery: ComputerDelivery;
}
export interface ComputerTarget {
  reference: ComputerTargetRef;
  kind: "window" | "desktop";
  title: string;
  application?: string | null;
}
export interface ComputerTargetRef {
  runtime_id: ComputerRef;
  target_id: ComputerRef;
}
export interface ComputerOpenedResponse {
  kind: "opened";
  target?: ComputerTarget | null;
  message: string;
}
export interface ComputerObservationResponse {
  kind: "observation";
  observation: ComputerObservation;
  image?: ComputerImageContent | null;
}
export interface ComputerObservation {
  id: ComputerRef;
  target: ComputerTargetRef;
  elements: ComputerElement[];
  screenshot?: ComputerScreenshot | null;
  truncated: boolean;
}
export interface ComputerElement {
  id: ComputerRef;
  role: string;
  label: string;
  value?: string | null;
  depth: number;
  actions: ComputerActionKind[];
}
/**
 * The Host resolves this immutable image reference to bytes; no local path is exposed.
 */
export interface ComputerScreenshot {
  id: ComputerRef;
  media_type: "image/png" | "image/jpeg";
  width: ComputerDimension;
  height: ComputerDimension;
}
export interface ComputerImageContent {
  media_type: "image/png" | "image/jpeg";
  data: string;
}
export interface ComputerReceiptResponse {
  kind: "receipt";
  receipt: ComputerActionReceipt;
}
export interface ComputerActionReceipt {
  request_id: ComputerRef;
  target: ComputerTargetRef;
  observation_id: ComputerRef;
  outcome: ComputerActionOutcome;
}
/**
 * Execution acknowledgement only; it does not assert a verified task outcome.
 */
export interface ComputerExecuted {
  status: "executed";
}
export interface ComputerRejected {
  status: "rejected";
  error: ComputerError;
}
export interface ComputerError {
  code: ComputerErrorCode;
  message: string;
}
/**
 * Effects may have happened. Observe again; never silently replay the input.
 */
export interface ComputerUnknown {
  status: "unknown";
  error: ComputerError;
}
export interface ComputerStoppedResponse {
  kind: "stopped";
}
export interface ComputerWorkerFailure {
  id: ComputerRef;
  error: ComputerError;
}
export interface ComputerUseState {
  enabled: boolean;
  running: boolean;
  status: ComputerDriverStatus;
  error?: string | null;
}
export interface ComputerSettingsEvent {
  version: 1;
  kind: "computer_settings";
  request_id: ComputerRef | null;
  text: "";
  data: ComputerSettingsData;
}
export interface ComputerSettingsData {
  enabled: boolean;
}
export interface ComputerSettingsErrorEvent {
  version: 1;
  kind: "computer_settings_error";
  request_id: string | null;
  text: "";
}
export interface ComputerStateEvent {
  version: 1;
  kind: "computer_state";
  request_id: null;
  text: "";
  data: ComputerUseState;
}
