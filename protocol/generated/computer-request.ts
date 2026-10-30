/* Generated from protocol/computer-runtime.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/computer-runtime.tsp. Do not edit.
 */
export type ComputerRequestContract =
  ComputerRequest | ComputerWorkerRequest | ComputerControl | ComputerSettingsRequest;
export type ComputerRequest =
  | ComputerStatusRequest
  | ComputerTargetsRequest
  | ComputerOpenRequest
  | ComputerObserveRequest
  | ComputerActRequest
  | ComputerStopRequest
  | ComputerReceiptRequest;
/**
 * Host-issued references, never OS handles, paths, credentials or caller identities.
 */
export type ComputerRef = string;
export type ComputerDelivery = "background" | "foreground";
export type ComputerInput = ComputerClick | ComputerTypeText | ComputerPressKey | ComputerScroll | ComputerDrag;
export type ComputerAnchor = ComputerElementAnchor | ComputerPixelAnchor;
export type ComputerMouseButton = "left" | "right" | "middle";
export type ComputerClickCount = number;
export type ComputerText = string;
export type ComputerKey = string;
export type ComputerControl =
  ComputerGetControl | ComputerSetControl | ComputerPermissionsControl | ComputerStopControl;
export type ComputerSettingsRequest = GetComputerSettings | SetComputerSettings;

export interface ComputerStatusRequest {
  operation: "status";
}
export interface ComputerTargetsRequest {
  operation: "targets";
}
export interface ComputerOpenRequest {
  operation: "open";
  application: string;
}
export interface ComputerObserveRequest {
  operation: "observe";
  target: ComputerTargetRef;
}
export interface ComputerTargetRef {
  runtime_id: ComputerRef;
  target_id: ComputerRef;
}
export interface ComputerActRequest {
  operation: "act";
  action: ComputerAction;
}
export interface ComputerAction {
  request_id: ComputerRef;
  target: ComputerTargetRef;
  observation_id: ComputerRef;
  delivery: ComputerDelivery;
  input: ComputerInput;
}
export interface ComputerClick {
  kind: "click";
  anchor: ComputerAnchor;
  button: ComputerMouseButton;
  count: ComputerClickCount;
}
export interface ComputerElementAnchor {
  kind: "element";
  element_id: ComputerRef;
}
export interface ComputerPixelAnchor {
  kind: "pixel";
  screenshot_id: ComputerRef;
  point: ComputerPoint;
}
/**
 * Zero-based pixels of the referenced screenshot, not global screen coordinates.
 */
export interface ComputerPoint {
  x: number;
  y: number;
}
export interface ComputerTypeText {
  kind: "type_text";
  anchor: ComputerAnchor;
  text: ComputerText;
}
/**
 * Logical key names/chords (for example ["Control", "a"]), mapped by the adapter.
 */
export interface ComputerPressKey {
  kind: "press_key";
  anchor: ComputerAnchor;
  /**
   * @minItems 1
   * @maxItems 8
   */
  keys:
    | [ComputerKey]
    | [ComputerKey, ComputerKey]
    | [ComputerKey, ComputerKey, ComputerKey]
    | [ComputerKey, ComputerKey, ComputerKey, ComputerKey]
    | [ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey]
    | [ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey]
    | [ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey]
    | [ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey, ComputerKey];
}
/**
 * Logical content pixels: positive right/down. An adapter must refuse unsupported units.
 */
export interface ComputerScroll {
  kind: "scroll";
  anchor: ComputerAnchor;
  delta_x: number;
  delta_y: number;
}
export interface ComputerDrag {
  kind: "drag";
  screenshot_id: ComputerRef;
  from: ComputerPoint;
  to: ComputerPoint;
}
export interface ComputerStopRequest {
  operation: "stop";
}
export interface ComputerReceiptRequest {
  operation: "receipt";
  request_id: ComputerRef;
}
/**
 * Private Desktop-to-worker envelope. The model only sees ComputerRequest.
 */
export interface ComputerWorkerRequest {
  id: ComputerRef;
  thread: ComputerRef;
  request: ComputerRequest;
}
export interface ComputerGetControl {
  action: "computer_get";
}
export interface ComputerSetControl {
  action: "computer_set";
  enabled: boolean;
}
export interface ComputerPermissionsControl {
  action: "computer_permissions";
}
export interface ComputerStopControl {
  action: "computer_stop";
}
export interface GetComputerSettings {
  method: "settings.computer.get";
}
export interface SetComputerSettings {
  method: "settings.computer";
  id: ComputerRef;
  enabled: boolean;
}
