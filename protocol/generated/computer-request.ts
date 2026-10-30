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
export type ComputerApplicationSelector = ComputerApplicationName | ComputerBundleSelector;
export type ComputerApplicationName = string;
/**
 * Host-issued references, never OS handles, paths, credentials or caller identities.
 */
export type ComputerRef = string;
export type ComputerDelivery = "background" | "foreground";
export type ComputerInput =
  | ComputerClick
  | ComputerTypeText
  | ComputerPressKey
  | ComputerScroll
  | ComputerDrag
  | ComputerSetValue
  | ComputerPerformAction
  | ComputerMove
  | ComputerHover
  | ComputerHold
  | ComputerFocusWindow;
export type ComputerAnchor = ComputerElementAnchor | ComputerPixelAnchor;
export type ComputerMouseButton = "left" | "right" | "middle";
export type ComputerClickCount = number;
export type ComputerText = string;
export type ComputerKey = string;
/**
 * Replacement permits an empty value to clear the field.
 */
export type ComputerValue = string;
export type ComputerSemanticAction =
  "press" | "open" | "confirm" | "cancel" | "show_menu" | "scroll_to_visible" | "increment" | "decrement";
/**
 * Pointer pause after reaching the anchor, in milliseconds.
 */
export type ComputerDwellMs = number;
/**
 * Button press duration before release, in milliseconds.
 */
export type ComputerHoldMs = number;
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
  application: ComputerApplicationSelector;
}
export interface ComputerBundleSelector {
  kind: "bundle_id";
  bundle_id: string;
}
export interface ComputerObserveRequest {
  operation: "observe";
  target: ComputerTargetRef;
  options?: ComputerObserveOptions;
}
export interface ComputerTargetRef {
  runtime_id: ComputerRef;
  target_id: ComputerRef;
}
export interface ComputerObserveOptions {
  want_image?: boolean;
  max_nodes?: number;
  max_depth?: number;
  root?: ComputerSubtree | null;
}
export interface ComputerSubtree {
  observation_id: ComputerRef;
  element_id: ComputerRef;
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
export interface ComputerSetValue {
  kind: "set_value";
  element_id: ComputerRef;
  value: ComputerValue;
}
export interface ComputerPerformAction {
  kind: "perform_action";
  element_id: ComputerRef;
  action: ComputerSemanticAction;
}
/**
 * Foreground moves the real pointer; background posts a window-directed move.
 */
export interface ComputerMove {
  kind: "move";
  anchor: ComputerAnchor;
}
/**
 * Moves the pointer to the anchor, then waits `dwell_ms` without button or key events.
 */
export interface ComputerHover {
  kind: "hover";
  anchor: ComputerAnchor;
  dwell_ms: ComputerDwellMs;
}
/**
 * Presses one button at the anchor, keeps it down for `hold_ms`, then always releases it.
 */
export interface ComputerHold {
  kind: "hold";
  anchor: ComputerAnchor;
  button: ComputerMouseButton;
  hold_ms: ComputerHoldMs;
}
/**
 * Explicit foreground focus; never implicit in a background input.
 */
export interface ComputerFocusWindow {
  kind: "focus_window";
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
