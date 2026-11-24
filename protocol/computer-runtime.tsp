import "./computer-use.tsp";
import "@typespec/json-schema";
using JsonSchema;
using Pero.Computer;
@jsonSchema
namespace Pero.Computer.Runtime;

model ComputerStatusRequest { operation: "status"; ...ComputerClosed; }
model ComputerTargetsRequest { operation: "targets"; ...ComputerClosed; }
@minLength(1) @maxLength(128) scalar ComputerApplicationName extends string;
model ComputerBundleSelector { kind: "bundle_id"; @minLength(1) @maxLength(128) bundle_id: string; ...ComputerClosed; }
@oneOf union ComputerApplicationSelector { ComputerApplicationName, ComputerBundleSelector }
model ComputerOpenRequest { operation: "open"; application: ComputerApplicationSelector; ...ComputerClosed; }
model ComputerSubtree { observation_id: ComputerRef; element_id: ComputerRef; ...ComputerClosed; }
model ComputerObserveOptions {
  want_image?: boolean;
  @minValue(1) @maxValue(4096) max_nodes?: uint16;
  @minValue(1) @maxValue(64) max_depth?: uint16;
  root?: ComputerSubtree | null;
  /** On macOS retain unlabeled layout containers in the returned tree. */
  include_containers?: boolean;
  /** Compare with the latest whole-window observation of this target. */
  since_observation_id?: ComputerRef;
  /** Return a full tree even when there is a compatible previous observation. */
  disable_diffing?: boolean;
  ...ComputerClosed;
}
model ComputerObserveRequest { operation: "observe"; target: ComputerTargetRef; options?: ComputerObserveOptions; ...ComputerClosed; }
model ComputerScreenshotRequest { operation: "screenshot"; target: ComputerTargetRef; recognize_text?: boolean; ...ComputerClosed; }
model ComputerReadOcrRequest { operation: "read_ocr"; screenshot_id: ComputerRef; ...ComputerClosed; }
model ComputerActRequest { operation: "act"; action: ComputerAction; ...ComputerClosed; }
model ComputerStopRequest { operation: "stop"; ...ComputerClosed; }
model ComputerReceiptRequest { operation: "receipt"; request_id: ComputerRef; ...ComputerClosed; }
@oneOf union ComputerRequest { ComputerStatusRequest, ComputerTargetsRequest, ComputerOpenRequest, ComputerObserveRequest, ComputerScreenshotRequest, ComputerReadOcrRequest, ComputerActRequest, ComputerStopRequest, ComputerReceiptRequest }
/** Private Desktop-to-worker envelope. The model only sees ComputerRequest. */
model ComputerWorkerRequest { id: ComputerRef; thread: ComputerRef; request: ComputerRequest; ...ComputerClosed; }
enum ComputerPermissionState { granted, not_detected, unsupported }
model ComputerDriverStatus { available: boolean; accessibility: ComputerPermissionState; screen_recording: ComputerPermissionState; message: string; environment?: ComputerEnvironment | null; ...ComputerClosed; }
model ComputerUseState { enabled: boolean; running: boolean; status: ComputerDriverStatus; error?: string | null; ...ComputerClosed; }
model ComputerImageContent { media_type: "image/png" | "image/jpeg"; data: string; ...ComputerClosed; }
enum ComputerCaptureStatus { captured, not_requested, subtree, screen_recording_required, incomplete_scan, secure_content, unavailable }
enum ComputerOcrStatus { not_requested, no_image, unsupported, busy, pending, ready, no_text, failed }
model ComputerStatusResponse { kind: "status"; status: ComputerDriverStatus; ...ComputerClosed; }
model ComputerTargetsResponse { kind: "targets"; capabilities: ComputerCapabilities; targets: ComputerTarget[]; ...ComputerClosed; }
model ComputerOpenedResponse { kind: "opened"; target?: ComputerTarget | null; message: string; ...ComputerClosed; }
model ComputerObservationDelta {
  base_observation_id: ComputerRef;
  removed_element_ids: ComputerRef[];
  /** Present when the incoming tree has a different element order or membership. */
  element_order?: ComputerRef[];
  ...ComputerClosed;
}
model ComputerObservationResponse {
  kind: "observation";
  observation: ComputerObservation;
  image?: ComputerImageContent | null;
  capture_status?: ComputerCaptureStatus;
  ocr_status?: ComputerOcrStatus;
  /** Unverified OCR of the same window image, when available. */
  @maxLength(6000) recognized_text?: string;
  /** When present, observation.elements contains only added or changed nodes. */
  delta?: ComputerObservationDelta;
  ...ComputerClosed;
}
model ComputerOcrResponse {
  kind: "ocr";
  screenshot_id: ComputerRef;
  ocr_status: ComputerOcrStatus;
  @maxLength(6000) recognized_text?: string;
  ...ComputerClosed;
}
model ComputerReceiptResponse { kind: "receipt"; receipt: ComputerActionReceipt; ...ComputerClosed; }
model ComputerStoppedResponse { kind: "stopped"; ...ComputerClosed; }
@oneOf union ComputerResponse { ComputerStatusResponse, ComputerTargetsResponse, ComputerOpenedResponse, ComputerObservationResponse, ComputerOcrResponse, ComputerReceiptResponse, ComputerStoppedResponse }
model ComputerWorkerSuccess { id: ComputerRef; value: ComputerResponse; ...ComputerClosed; }
model ComputerWorkerFailure { id: ComputerRef; error: ComputerError; ...ComputerClosed; }
@oneOf union ComputerWorkerResponse { ComputerWorkerSuccess, ComputerWorkerFailure }
model ComputerGetControl { action: "computer_get"; ...ComputerClosed; }
model ComputerSetControl { action: "computer_set"; enabled: boolean; ...ComputerClosed; }
model ComputerPermissionsControl { action: "computer_permissions"; ...ComputerClosed; }
model ComputerStopControl { action: "computer_stop"; ...ComputerClosed; }
@oneOf union ComputerControl { ComputerGetControl, ComputerSetControl, ComputerPermissionsControl, ComputerStopControl }
model GetComputerSettings { method: "settings.computer.get"; ...ComputerClosed; }
model SetComputerSettings { method: "settings.computer"; id: ComputerRef; enabled: boolean; ...ComputerClosed; }
@oneOf union ComputerSettingsRequest { GetComputerSettings, SetComputerSettings }
model ComputerSettingsData { enabled: boolean; ...ComputerClosed; }
model ComputerSettingsEvent { version: 1; kind: "computer_settings"; request_id: ComputerRef | null; text: ""; data: ComputerSettingsData; ...ComputerClosed; }
model ComputerSettingsErrorEvent { version: 1; kind: "computer_settings_error"; request_id: string | null; text: ""; ...ComputerClosed; }
model ComputerStateEvent { version: 1; kind: "computer_state"; request_id: null; text: ""; data: ComputerUseState; ...ComputerClosed; }
