/* Generated from protocol/computer-use.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/computer-use.tsp. Do not edit.
 */
export type ComputerObservationContract = ComputerCapabilities | ComputerTarget | ComputerObservation;
/**
 * Host-issued references, never OS handles, paths, credentials or caller identities.
 */
export type ComputerRef = string;
export type ComputerPlatform = "macos" | "windows" | "linux" | "other";
export type ComputerDisplay = "native" | "x11" | "xwayland" | "wayland" | "unavailable";
export type ComputerObservationKind = "accessibility" | "screenshot";
export type ComputerActionKind = "click" | "type_text" | "press_key" | "scroll" | "drag";
export type ComputerDelivery = "background" | "foreground";
export type ComputerAddressing = "element" | "pixel";
export type ComputerDimension = number;

export interface ComputerCapabilities {
  protocol: "pero.computer-use.v1";
  runtime_id: ComputerRef;
  environment: ComputerEnvironment;
  observations: ComputerObservationKind[];
  actions: ComputerActionSupport[];
}
export interface ComputerEnvironment {
  platform: ComputerPlatform;
  display: ComputerDisplay;
  desktop?: string | null;
}
/**
 * Supported addressing for an action/delivery pair; target-specific refusals remain possible.
 */
export interface ComputerActionSupport {
  action: ComputerActionKind;
  delivery: ComputerDelivery;
  addressing: ComputerAddressing[];
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
