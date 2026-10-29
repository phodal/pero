// The standalone App does not generate workbench Wasm. Keep source-only type
// checks typed; a workbench build also checks against wasm-bindgen's declarations.
declare module '*wasm/pero_ui' {
  export default function init(): Promise<unknown>;
  export function run(theme_json: string, dark: boolean, locale: string): void;
  export function receive_host_event(json: string): void;
  export function snapshot(): string;
  export function paste_image(data: string, mime_type: string): void;
  export function set_system_theme(dark: boolean): void;
}
declare module '*chat-wasm/pero_chat_web' {
  export default function init(): Promise<unknown>;
  export function run(theme_json: string, dark: boolean, locale: string): void;
  export function receive_host_event(json: string): void;
  export function snapshot(): string;
  export function paste_image(data: string, mime_type: string): void;
  export function set_system_theme(dark: boolean): void;
  export function set_appearance(json: string): void;
  export function compose(text: string): void;
}
