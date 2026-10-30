import "./computer-use.tsp";
import "@typespec/json-schema";
using JsonSchema;
using Pero.Computer;
@jsonSchema
namespace Pero.Computer.Runtime;

model ComputerStatusRequest { operation: "status"; ...ComputerClosed; }
model ComputerTargetsRequest { operation: "targets"; ...ComputerClosed; }
model ComputerOpenRequest { operation: "open"; @minLength(1) @maxLength(128) application: string; ...ComputerClosed; }
model ComputerObserveRequest { operation: "observe"; target: ComputerTargetRef; ...ComputerClosed; }
model ComputerActRequest { operation: "act"; action: ComputerAction; ...ComputerClosed; }
model ComputerStopRequest { operation: "stop"; ...ComputerClosed; }
model ComputerReceiptRequest { operation: "receipt"; request_id: ComputerRef; ...ComputerClosed; }
@oneOf union ComputerRequest { ComputerStatusRequest, ComputerTargetsRequest, ComputerOpenRequest, ComputerObserveRequest, ComputerActRequest, ComputerStopRequest, ComputerReceiptRequest }
/** Private Desktop-to-worker envelope. The model only sees ComputerRequest. */
model ComputerWorkerRequest { id: ComputerRef; thread: ComputerRef; request: ComputerRequest; ...ComputerClosed; }
enum ComputerPermissionState { granted, not_detected, unsupported }
model ComputerDriverStatus { available: boolean; accessibility: ComputerPermissionState; screen_recording: ComputerPermissionState; message: string; environment?: ComputerEnvironment | null; ...ComputerClosed; }
model ComputerUseState { enabled: boolean; running: boolean; status: ComputerDriverStatus; error?: string | null; ...ComputerClosed; }
model ComputerImageContent { media_type: "image/png" | "image/jpeg"; data: string; ...ComputerClosed; }
model ComputerStatusResponse { kind: "status"; status: ComputerDriverStatus; ...ComputerClosed; }
model ComputerTargetsResponse { kind: "targets"; capabilities: ComputerCapabilities; targets: ComputerTarget[]; ...ComputerClosed; }
model ComputerOpenedResponse { kind: "opened"; target?: ComputerTarget | null; message: string; ...ComputerClosed; }
model ComputerObservationResponse { kind: "observation"; observation: ComputerObservation; image?: ComputerImageContent | null; ...ComputerClosed; }
model ComputerReceiptResponse { kind: "receipt"; receipt: ComputerActionReceipt; ...ComputerClosed; }
model ComputerStoppedResponse { kind: "stopped"; ...ComputerClosed; }
@oneOf union ComputerResponse { ComputerStatusResponse, ComputerTargetsResponse, ComputerOpenedResponse, ComputerObservationResponse, ComputerReceiptResponse, ComputerStoppedResponse }
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
