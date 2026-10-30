/* Generated from protocol/computer-use.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/computer-use.tsp. Do not edit.
 */
export type ComputerActionContract = ComputerAction | ComputerActionReceipt | ComputerError;
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
  | ComputerLongPress
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
export type ComputerHoldMillis = number;
export type ComputerActionOutcome = ComputerExecuted | ComputerRejected | ComputerUnknown;
/**
 * Execution acknowledgement only; it does not assert a verified task outcome.
 */
export type ComputerExecutionRoute = "semantic" | "window_event" | "foreground_event";
export type ComputerErrorCode =
  | "unsupported"
  | "permission_required"
  | "target_unavailable"
  | "stale_observation"
  | "invalid_request"
  | "cancelled"
  | "timeout"
  | "failed";

export interface ComputerAction {
  request_id: ComputerRef;
  target: ComputerTargetRef;
  observation_id: ComputerRef;
  delivery: ComputerDelivery;
  input: ComputerInput;
}
export interface ComputerTargetRef {
  runtime_id: ComputerRef;
  target_id: ComputerRef;
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
export interface ComputerLongPress {
  kind: "long_press";
  anchor: ComputerAnchor;
  button: ComputerMouseButton;
  hold_ms: ComputerHoldMillis;
}
/**
 * Explicit foreground focus; never implicit in a background input.
 */
export interface ComputerFocusWindow {
  kind: "focus_window";
}
export interface ComputerActionReceipt {
  request_id: ComputerRef;
  target: ComputerTargetRef;
  observation_id: ComputerRef;
  outcome: ComputerActionOutcome;
}
export interface ComputerExecuted {
  status: "executed";
  execution?: ComputerExecution | null;
}
export interface ComputerExecution {
  route: ComputerExecutionRoute;
  semantic_action?: ComputerSemanticAction | null;
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
