import "@typespec/json-schema";
using JsonSchema;
@jsonSchema
namespace Pero.Computer;

model ComputerClosed { ...Record<never>; }
/** Host-issued references, never OS handles, paths, credentials or caller identities. */
@minLength(1) @maxLength(128) @pattern("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
scalar ComputerRef extends string;
@minValue(1) scalar ComputerDimension extends uint32;
@minValue(1) @maxValue(3) scalar ComputerClickCount extends uint8;
@minLength(1) @maxLength(10000) scalar ComputerText extends string;
@minLength(1) @maxLength(64) scalar ComputerKey extends string;

/** Replacement permits an empty value to clear the field. */
@maxLength(10000) scalar ComputerValue extends string;
enum ComputerActionKind { click, type_text, press_key, scroll, drag, set_value, perform_action, move, long_press, focus_window }
enum ComputerSemanticAction { press, open, confirm, cancel, show_menu, scroll_to_visible, increment, decrement }
enum ComputerDelivery { background, foreground }
enum ComputerAddressing { element, pixel, target }
enum ComputerObservationKind { accessibility, screenshot }
enum ComputerPlatform { macos, windows, linux, other }
enum ComputerDisplay { native, x11, xwayland, wayland, unavailable }
model ComputerEnvironment {
  platform: ComputerPlatform;
  display: ComputerDisplay;
  desktop?: string | null;
  ...ComputerClosed;
}
enum ComputerMouseButton { left, right, middle }
enum ComputerErrorCode {
  unsupported, permission_required, target_unavailable, stale_observation,
  invalid_request, cancelled, timeout, failed
}

model ComputerTargetRef {
  runtime_id: ComputerRef;
  target_id: ComputerRef;
  ...ComputerClosed;
}
model ComputerTarget {
  reference: ComputerTargetRef;
  kind: "window" | "desktop";
  title: string;
  application?: string | null;
  application_id?: string | null;
  ...ComputerClosed;
}
/** Supported addressing for an action/delivery pair; target-specific refusals remain possible. */
model ComputerActionSupport {
  action: ComputerActionKind;
  delivery: ComputerDelivery;
  addressing: ComputerAddressing[];
  ...ComputerClosed;
}
model ComputerCapabilities {
  protocol: "pero.computer-use.v1";
  runtime_id: ComputerRef;
  environment: ComputerEnvironment;
  observations: ComputerObservationKind[];
  actions: ComputerActionSupport[];
  ...ComputerClosed;
}
model ComputerElement {
  id: ComputerRef;
  role: string;
  label: string;
  value?: string | null;
  depth: uint16;
  actions: ComputerActionKind[];
  state?: ComputerElementState | null;
  semantic_actions?: ComputerSemanticAction[];
  ...ComputerClosed;
}
model ComputerElementState {
  enabled: boolean;
  secure: boolean;
  focused: boolean;
  value_settable: boolean;
  selected?: boolean | null;
  expanded?: boolean | null;
  ...ComputerClosed;
}
/** The Host resolves this immutable image reference to bytes; no local path is exposed. */
model ComputerScreenshot {
  id: ComputerRef;
  media_type: "image/png" | "image/jpeg";
  width: ComputerDimension;
  height: ComputerDimension;
  ...ComputerClosed;
}
model ComputerObservation {
  id: ComputerRef;
  target: ComputerTargetRef;
  elements: ComputerElement[];
  screenshot?: ComputerScreenshot | null;
  truncated: boolean;
  ...ComputerClosed;
}
/** Zero-based pixels of the referenced screenshot, not global screen coordinates. */
model ComputerPoint { x: uint32; y: uint32; ...ComputerClosed; }
model ComputerElementAnchor { kind: "element"; element_id: ComputerRef; ...ComputerClosed; }
model ComputerPixelAnchor {
  kind: "pixel";
  screenshot_id: ComputerRef;
  point: ComputerPoint;
  ...ComputerClosed;
}
@oneOf union ComputerAnchor { ComputerElementAnchor, ComputerPixelAnchor }
model ComputerClick {
  kind: "click";
  anchor: ComputerAnchor;
  button: ComputerMouseButton;
  count: ComputerClickCount;
  ...ComputerClosed;
}
model ComputerTypeText { kind: "type_text"; anchor: ComputerAnchor; text: ComputerText; ...ComputerClosed; }
/** Logical key names/chords (for example ["Control", "a"]), mapped by the adapter. */
model ComputerPressKey {
  kind: "press_key";
  anchor: ComputerAnchor;
  @minItems(1) @maxItems(8) keys: ComputerKey[];
  ...ComputerClosed;
}
/** Logical content pixels: positive right/down. An adapter must refuse unsupported units. */
model ComputerScroll {
  kind: "scroll";
  anchor: ComputerAnchor;
  delta_x: int32;
  delta_y: int32;
  ...ComputerClosed;
}
model ComputerDrag {
  kind: "drag";
  screenshot_id: ComputerRef;
  from: ComputerPoint;
  to: ComputerPoint;
  ...ComputerClosed;
}
model ComputerSetValue { kind: "set_value"; element_id: ComputerRef; value: ComputerValue; ...ComputerClosed; }
model ComputerPerformAction { kind: "perform_action"; element_id: ComputerRef; action: ComputerSemanticAction; ...ComputerClosed; }
/** Foreground moves the real pointer; background posts a window-directed move. */
model ComputerMove { kind: "move"; anchor: ComputerAnchor; ...ComputerClosed; }
@minValue(1) @maxValue(10000) scalar ComputerHoldMillis extends uint16;
model ComputerLongPress { kind: "long_press"; anchor: ComputerAnchor; button: ComputerMouseButton; hold_ms: ComputerHoldMillis; ...ComputerClosed; }
/** Explicit foreground focus; never implicit in a background input. */
model ComputerFocusWindow { kind: "focus_window"; ...ComputerClosed; }
@oneOf union ComputerInput { ComputerClick, ComputerTypeText, ComputerPressKey, ComputerScroll, ComputerDrag, ComputerSetValue, ComputerPerformAction, ComputerMove, ComputerLongPress, ComputerFocusWindow }
model ComputerAction {
  request_id: ComputerRef;
  target: ComputerTargetRef;
  observation_id: ComputerRef;
  delivery: ComputerDelivery;
  input: ComputerInput;
  ...ComputerClosed;
}
model ComputerError { code: ComputerErrorCode; message: string; ...ComputerClosed; }
/** Execution acknowledgement only; it does not assert a verified task outcome. */
enum ComputerExecutionRoute { semantic, window_event, foreground_event }
model ComputerExecution { route: ComputerExecutionRoute; semantic_action?: ComputerSemanticAction | null; ...ComputerClosed; }
model ComputerExecuted { status: "executed"; execution?: ComputerExecution | null; ...ComputerClosed; }
model ComputerRejected { status: "rejected"; error: ComputerError; ...ComputerClosed; }
/** Effects may have happened. Observe again; never silently replay the input. */
model ComputerUnknown { status: "unknown"; error: ComputerError; ...ComputerClosed; }
@oneOf union ComputerActionOutcome { ComputerExecuted, ComputerRejected, ComputerUnknown }
model ComputerActionReceipt {
  request_id: ComputerRef;
  target: ComputerTargetRef;
  observation_id: ComputerRef;
  outcome: ComputerActionOutcome;
  ...ComputerClosed;
}
