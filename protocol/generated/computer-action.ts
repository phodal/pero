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
export type ComputerInput = ComputerClick | ComputerTypeText | ComputerPressKey | ComputerScroll | ComputerDrag;
export type ComputerAnchor = ComputerElementAnchor | ComputerPixelAnchor;
export type ComputerMouseButton = "left" | "right" | "middle";
export type ComputerClickCount = number;
export type ComputerText = string;
export type ComputerKey = string;
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
