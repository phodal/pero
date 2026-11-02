// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import { ensureDesignTokens } from '../tokens/ensure-tokens.mjs';
/** Exported for isolated renderers whose CSP requires external stylesheets. */
export const uiStyles = `
.pero-ui-markdown-text { min-width:0; overflow-wrap:anywhere; color:var(--pero-text); font:inherit; line-height:1.7; }
.pero-ui-markdown-text > :first-child { margin-top:0; }
.pero-ui-markdown-text > :last-child { margin-bottom:0; }
.pero-ui-markdown-text :is(h2,h3,h4,h5,h6) { margin:1.4em 0 .6em; font-weight:600; line-height:1.4; }
.pero-ui-markdown-text h2 { font-size:var(--pero-font-size-xl,20px); }
.pero-ui-markdown-text h3 { font-size:var(--pero-font-size-lg,16px); }
.pero-ui-markdown-text :is(h4,h5,h6) { font-size:1em; }
.pero-ui-markdown-text :is(p,ul,ol) { margin:.7em 0; }
.pero-ui-markdown-text :is(ul,ol) { padding-inline-start:1.6em; }
.pero-ui-markdown-text li + li { margin-top:.3em; }
.pero-ui-markdown-text code { font-family:var(--pero-font-family-mono,ui-monospace,monospace); font-size:.92em; }
.pero-ui-markdown-text pre { max-width:100%; overflow:auto; padding:var(--pero-space-6,12px); background:var(--pero-surface-muted); border-radius:var(--pero-radius-sm,6px); white-space:pre; }
.pero-ui-markdown-table { max-width:100%; overflow:auto; margin:.8em 0; }
.pero-ui-markdown-table table { width:100%; border-collapse:collapse; text-align:start; }
.pero-ui-markdown-table :is(th,td) { border:var(--pero-border-width-thin,1px) solid var(--pero-border-subtle); padding:var(--pero-space-4,8px); text-align:start; vertical-align:top; }
.pero-ui-markdown-table th { background:var(--pero-surface-muted); font-weight:600; }
.pero-ui-markdown-table:focus-visible { outline:var(--pero-focus-ring-width,2px) solid var(--pero-focus); outline-offset:2px; }
.pero-ui-code-viewer, .pero-ui-code-viewer>.pero-source-pane, .pero-ui-code-editor, .pero-ui-code-editor>.pero-source-pane, .pero-ui-code-compare-shell, .pero-ui-code-compare-shell>.pero-ui-code-compare, .pero-ui-code-compare-shell .cm-mergeView { height:100%; min-height:150px; min-width:0; overflow:hidden; }
.pero-ui-code-compare-shell .cm-mergeView { overflow:auto; }
.pero-ui-code-editor .cm-mermaid-keyword, .pero-ui-code-editor .cm-mermaid-operator { color: var(--pero-source-accent, var(--pero-ai)); }
.pero-ui-code-editor .cm-mermaid-comment { color: var(--pero-source-muted, var(--pero-text-secondary)); }
.pero-ui-code-editor .cm-mermaid-literal, .pero-ui-code-editor .cm-mermaid-type { color: var(--pero-source-literal, var(--pero-success)); }
.pero-ui-command-line { min-width:0; overflow:hidden; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:var(--pero-radius-sm, 6px); background:var(--pero-source-background, var(--pero-surface-muted)); }
.pero-ui-command-line .cm-editor { height:auto; }
.pero-ui-command-line-fallback { margin:0; padding:4px 8px; overflow-x:auto; white-space:pre; font:12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; }
.pero-ui-file-tree { outline:none; min-width:0; color:var(--pero-text); font:inherit; }
.pero-ui-file-tree-item { outline:none; border-radius:var(--pero-radius-sm,6px); border-inline-start:2px solid transparent; cursor:default; }
.pero-ui-file-tree-item[data-hovered] { background:var(--pero-hover); }
.pero-ui-file-tree-item[data-selected] { background:var(--pero-active); border-inline-start-color:var(--pero-accent); }
.pero-ui-file-tree-item[data-focus-visible] { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:calc(-1 * var(--pero-focus-ring-width, 2px)); }
.pero-ui-file-tree-row { display:flex; align-items:center; gap:var(--pero-space-2,4px); min-height:30px; padding-inline-end:var(--pero-space-4,8px); }
.pero-ui-file-tree-row>svg, .pero-ui-file-tree-toggle { flex:none; }
.pero-ui-file-tree-toggle.pero-ui-button { width:24px; min-height:24px; padding:0; color:var(--pero-text-secondary, currentColor); }
.pero-ui-file-tree-toggle svg { display:block; width:14px; height:14px; overflow:visible; }
.pero-ui-file-tree-toggle svg path { width:auto; height:auto; }
.pero-ui-file-tree-spacer { width:24px; flex:none; }
.pero-ui-file-tree-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pero-ui-suggestion-list { margin:0; padding:2px; list-style:none; max-height:220px; overflow:auto; overscroll-behavior:contain; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:var(--pero-radius-md, 8px); background:var(--pero-surface); color:var(--pero-text); box-shadow:var(--pero-elevation-md,0 8px 24px var(--pero-shadow, rgb(0 0 0 / .12))); }
.pero-ui-suggestion-option { box-sizing:border-box; display:flex; flex-direction:row; align-items:baseline; gap:var(--pero-space-4, 8px); width:100%; min-height:28px; padding:2px var(--pero-space-4, 8px); border:0; border-radius:var(--pero-radius-sm, 6px); background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.pero-ui-suggestion-option[data-active=true], .pero-ui-suggestion-option:hover { background:var(--pero-hover); }
.pero-ui-suggestion-option[aria-selected=true] { background:color-mix(in srgb, var(--pero-accent, #315be8) 10%, transparent); }
.pero-ui-suggestion-option:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:calc(-1 * var(--pero-focus-ring-width, 2px)); }
.pero-ui-suggestion-check { flex:none; width:1ch; color:var(--pero-accent, #315be8); font-size:var(--pero-font-size-sm, 12px); line-height:1; }
.pero-ui-suggestion-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:var(--pero-font-weight-medium, 500); }
.pero-ui-suggestion-hint { flex:none; color:var(--pero-text-secondary); font-size:var(--pero-font-size-sm, 12px); font-weight:var(--pero-font-weight-regular, 400); white-space:nowrap; }

.pero-ui-time-field { display:flex; flex-direction:column; gap:var(--pero-space-3, 6px); min-width:0; }
.pero-ui-time-input { display:flex; align-items:center; box-sizing:border-box; min-height:34px; width:100%; padding:var(--pero-space-2, 4px) var(--pero-space-5, 10px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-control, #ddd); border-radius:var(--pero-radius-md, 8px); background:var(--pero-surface, #fff); color:var(--pero-text, #202124); font:inherit; font-variant-numeric:tabular-nums; cursor:text; }
.pero-ui-time-input[data-focus-within] { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-time-input[data-disabled] { opacity:.5; cursor:default; }
.pero-ui-time-input[data-invalid] { border-color:var(--pero-danger, #c5221f); }
.pero-ui-time-segment { padding:var(--pero-space-1, 2px); border-radius:var(--pero-radius-xs, 4px); outline:none; caret-color:transparent; }
.pero-ui-time-segment[data-type=hour], .pero-ui-time-segment[data-type=minute] { min-width:2ch; text-align:center; }
.pero-ui-time-segment[data-placeholder] { color:var(--pero-text-secondary, #666); }
.pero-ui-time-segment[data-focused] { background:var(--pero-hover, #eeeff1); color:var(--pero-accent, #315be8); box-shadow:inset 0 0 0 var(--pero-border-width-thin, 1px) currentColor; }
.pero-ui-dialog:not([data-unstyled]) { box-sizing: border-box; width: min(560px, calc(100vw - 32px)); max-height: min(80vh, 680px); padding:0; border: var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle, #ddd); border-radius:var(--pero-radius-xl, 12px); color: var(--pero-text, #202124); background: var(--pero-surface, #fff); box-shadow: 0 16px 48px var(--pero-domain-app-sdk-pero-ui-dialog-shadow, #0003); overflow: hidden; font:inherit; text-align:left; }
.pero-ui-dialog:not([data-unstyled])[data-size=sm] { width: min(420px, calc(100vw - 32px)); }
.pero-ui-dialog:not([data-unstyled])[data-size=lg] { width: min(720px, calc(100vw - 32px)); }
.pero-ui-dialog:not([data-unstyled])[open] { display: flex; flex-direction: column; }
.pero-ui-dialog:not([data-unstyled])::backdrop { background: var(--pero-domain-app-sdk-backdrop-bg, #0005); backdrop-filter: blur(2px); }
.pero-ui-dialog *, .pero-ui-dialog *::before, .pero-ui-dialog *::after { box-sizing: border-box; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-frame { display: flex; flex-direction: column; flex: 1; min-height: 0; margin: 0; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-head { display: flex; align-items: center; gap:var(--pero-space-6, 12px); padding:var(--pero-space-3, 6px) var(--pero-space-4, 8px) var(--pero-space-3, 6px) var(--pero-space-7, 14px); border-bottom: var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle, #ddd); flex: none; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-head h2 { flex: 1; min-width: 0; margin: 0; font-size:14.5px; font-weight:var(--pero-font-weight-semibold, 600); line-height:var(--pero-line-height-snug, 1.4); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pero-ui-dialog .pero-ui-dialog-close { flex: none; display: flex; align-items: center; justify-content: center; width: var(--pero-size-hit-min, 24px); height: var(--pero-size-hit-min, 24px); min-height: 0; padding:0; border: 0; border-radius:var(--pero-radius-sm, 6px); background: none; color: var(--pero-text-secondary, #666); font-size:var(--pero-font-size-xl, 18px); line-height:1; cursor: pointer; }
.pero-ui-dialog .pero-ui-dialog-close:hover { background: var(--pero-hover, #eeeff1); color: inherit; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-body { flex: 1; min-height: 0; overflow: auto; padding:var(--pero-space-6, 12px) var(--pero-space-7, 14px); display: flex; flex-direction: column; gap:var(--pero-space-5, 10px); text-align: left; font-size:var(--pero-font-size-md, 13px); }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-foot { display: flex; align-items: center; justify-content: flex-end; gap:var(--pero-space-4, 8px); padding:var(--pero-space-4, 8px) var(--pero-space-7, 14px); border-top: var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle, #ddd); flex: none; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-foot .pero-ui-button:not([data-variant=unstyled]) { min-height: var(--pero-size-control-sm, 28px); padding-block: 3px; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-foot-start { display: flex; align-items: center; gap:var(--pero-space-4, 8px); margin-right: auto; }
.pero-ui-tooltip { position:fixed; z-index:1100; box-sizing:border-box; width:max-content; max-width:min(320px,calc(100vw - 16px)); padding:var(--pero-space-4, 8px) var(--pero-space-5, 10px); border-radius:9px; background:var(--pero-text, #202124); color:var(--pero-surface, #fff); font:400 12.5px/1.55 system-ui; text-align:left; white-space:pre-line; overflow-wrap:anywhere; pointer-events:auto; box-shadow:0 8px 24px var(--pero-domain-app-sdk-pero-ui-tooltip-shadow, rgb(0 0 0 / .2)); -webkit-app-region:no-drag; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-body > * { flex:none; margin:0; }
.pero-ui-dialog:not([data-unstyled]) .pero-ui-dialog-body p { margin:0; line-height:1.55; }
.pero-ui-help-tip { display:inline-flex; flex:none; vertical-align:middle; }
.pero-ui-help-tip .pero-ui-help-tip-button { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; min-height:0; padding:0; border:0; border-radius:50%; background:transparent; color:var(--pero-text-secondary); cursor:help; }
.pero-ui-help-tip-button:hover, .pero-ui-help-tip-button[aria-expanded=true] { background:var(--pero-hover); color:var(--pero-text); }
.pero-ui-help-tip-button:focus-visible, .pero-ui-dialog-close:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }

.pero-ui-popover { display:inline-flex; min-width:0; }
.pero-ui-popover-trigger { -webkit-app-region:no-drag; }
.pero-ui-popover-trigger:not([data-unstyled]) { font:inherit; color:inherit; padding:var(--pero-space-3, 6px) var(--pero-space-5, 10px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:7px; background:var(--pero-surface); }
.pero-ui-popover-panel { position:fixed; z-index:1000; box-sizing:border-box; min-width:min(200px,calc(100vw - 16px)); overflow:auto; overscroll-behavior:contain; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:var(--pero-radius-xl, 12px); background:var(--pero-surface); color:var(--pero-text); font-size:var(--pero-font-size-md, 13px); text-align:left; white-space:normal; box-shadow:0 14px 36px -8px var(--pero-domain-app-sdk-pero-ui-popover-panel-shadow, rgb(15 18 25 / .2)); -webkit-app-region:no-drag; }

.pero-ui-empty-state { min-width:0; box-sizing:border-box; }
.pero-ui-empty-state:not([data-unstyled]) { padding:var(--pero-space-10, 20px); color:var(--pero-text-secondary); overflow-wrap:anywhere; }
.pero-ui-empty-state:not(p):not([data-unstyled]) { display:grid; justify-items:center; gap:var(--pero-space-5, 10px); text-align:center; }
.pero-ui-empty-icon { display:inline-flex; }
.pero-ui-empty-heading { color:var(--pero-text); }
.pero-ui-empty-heading > *, .pero-ui-empty-description > * { margin:0; }
.pero-ui-empty-actions { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:var(--pero-space-4, 8px); max-width:100%; }
.pero-ui-toolbar:not([data-unstyled]) { display:flex; align-items:center; flex-wrap:wrap; gap:var(--pero-space-4, 8px); min-width:0; }
.pero-ui-toolbar:not([data-unstyled]) > * { min-width:0; max-width:100%; }
.pero-ui-toolbar-actions:not([data-unstyled]) { display:flex; align-items:center; flex-wrap:wrap; gap:var(--pero-space-4, 8px); margin-inline-start:auto; max-width:100%; }

.pero-ui-button:not([data-variant=unstyled]) { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:var(--pero-space-3, 6px); min-height:var(--pero-size-control, 30px); padding:5px var(--pero-space-5, 10px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:7px; background:var(--pero-surface); color:var(--pero-text); font:inherit; cursor:pointer; }
.pero-ui-button[data-variant=primary] { background:var(--pero-primary); border-color:var(--pero-primary-border); color:var(--pero-on-primary); }
.pero-ui-button[data-variant=danger] { color:var(--pero-danger); }
.pero-ui-button[data-variant=ghost] { background:transparent; border-color:transparent; }
.pero-ui-button:not([data-variant=unstyled])[aria-pressed=true], .pero-ui-button:not([data-variant=unstyled])[aria-current=page] { background:color-mix(in srgb,var(--pero-accent, #315be8) 12%,transparent); border-color:var(--pero-accent, #315be8); color:var(--pero-accent, #315be8); }
.pero-ui-icon-button:not([data-variant=unstyled]) { width:var(--pero-size-control, 30px); height:var(--pero-size-control, 30px); padding:5px; flex:none; }
.pero-ui-button:not([data-variant=unstyled]):disabled, .pero-ui-button:not([data-variant=unstyled])[aria-disabled=true] { opacity:.5; cursor:default; }
.pero-ui-button:not([data-variant=unstyled]):focus-visible, .pero-ui-switch:not([data-unstyled]):focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-switch:not([data-unstyled]) { box-sizing:border-box; position:relative; display:inline-flex; align-items:center; width:36px; height:22px; min-height:22px; padding:3px; border:0; border-radius:var(--pero-radius-full, 999px); background:var(--pero-text-secondary); cursor:pointer; }
.pero-ui-switch:not([data-unstyled])[data-state=checked] { background:var(--pero-accent); }
.pero-ui-switch:not([data-unstyled]):disabled { opacity:.5; cursor:default; }
.pero-ui-switch:not([data-unstyled]) > .pero-ui-switch-thumb { width:16px; height:16px; border-radius:50%; background:var(--pero-surface); transform:translateX(0); transition:transform var(--pero-duration-base, .15s); }
.pero-ui-switch:not([data-unstyled])[data-state=checked] > .pero-ui-switch-thumb { transform:translateX(14px); }
@media (prefers-reduced-motion:reduce) { .pero-ui-switch-thumb { transition:none; } }
.pero-ui-field { min-width:0; }
.pero-ui-field:not([data-unstyled]) { display:grid; gap:var(--pero-space-3, 6px); font:inherit; }
.pero-ui-field > label, .pero-ui-field > small, .pero-ui-feedback { overflow-wrap:anywhere; }
.pero-ui-field:not([data-unstyled]) > small { color:var(--pero-text-secondary); }
.pero-ui-input:not([data-unstyled]), .pero-ui-textarea:not([data-unstyled]) { box-sizing:border-box; width:100%; min-width:0; padding:7px 9px; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-control); border-radius:7px; background:var(--pero-surface); color:var(--pero-text); font:inherit; }
.pero-ui-textarea:not([data-unstyled]) { resize:vertical; }
.pero-ui-input:not([data-unstyled]):disabled, .pero-ui-textarea:not([data-unstyled]):disabled { opacity:.5; cursor:default; }
.pero-ui-input:not([data-unstyled]):focus-visible, .pero-ui-textarea:not([data-unstyled]):focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-input:not([data-unstyled])[aria-invalid=true], .pero-ui-textarea:not([data-unstyled])[aria-invalid=true] { border-color:var(--pero-danger); }
.pero-ui-feedback:not([data-unstyled]) { margin:0; color:var(--pero-text-secondary); }
.pero-ui-feedback:not([data-unstyled])[data-kind=error] { color:var(--pero-danger); }
.pero-ui-checkbox:not([data-unstyled]), .pero-ui-radio-item:not([data-unstyled]) { box-sizing:border-box; display:inline-flex; flex:none; align-items:center; justify-content:center; width:18px; height:18px; min-height:18px; margin:0; padding:0; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-control); background:var(--pero-surface); color:var(--pero-text); font:inherit; cursor:pointer; }
.pero-ui-checkbox:not([data-unstyled]) { border-radius:var(--pero-radius-xs, 4px); }
.pero-ui-checkbox:not([data-unstyled])[data-state=checked], .pero-ui-checkbox:not([data-unstyled])[data-state=indeterminate] { background:var(--pero-accent); border-color:transparent; color:var(--pero-surface); }
.pero-ui-checkbox-indicator { display:inline-flex; align-items:center; justify-content:center; line-height:1; }
.pero-ui-radio-group:not([data-unstyled]) { display:grid; gap:var(--pero-space-4, 8px); }
.pero-ui-radio-item:not([data-unstyled]) { border-radius:50%; }
.pero-ui-radio-item:not([data-unstyled])[data-state=checked] { border-color:var(--pero-accent); }
.pero-ui-radio-indicator { display:inline-flex; align-items:center; justify-content:center; color:var(--pero-accent); }
.pero-ui-tabs { min-width:0; }
.pero-ui-tabs-list:not([data-unstyled]) { display:flex; gap:var(--pero-space-2, 4px); max-width:100%; overflow-x:auto; }
.pero-ui-tabs-list:not([data-unstyled])[data-orientation=vertical] { flex-direction:column; }
.pero-ui-tabs-trigger:not([data-unstyled]) { flex:none; min-height:var(--pero-size-control, 30px); padding:5px var(--pero-space-5, 10px); border:0; border-radius:7px; background:transparent; color:var(--pero-text-secondary); font:inherit; cursor:pointer; }
.pero-ui-tabs-trigger:not([data-unstyled])[data-state=active] { background:var(--pero-hover); color:var(--pero-text); }
.pero-ui-tabs-content { min-width:0; }
.pero-ui-tabs-content[data-state=inactive] { display:none; }
.pero-ui-toggle-group:not([data-unstyled]) { display:inline-flex; gap:var(--pero-space-1, 2px); max-width:100%; }
.pero-ui-toggle-group:not([data-unstyled])[data-orientation=vertical] { flex-direction:column; }
.pero-ui-toggle-item:not([data-unstyled]) { flex:none; min-height:var(--pero-size-control, 30px); padding:5px var(--pero-space-5, 10px); border:0; border-radius:7px; background:transparent; color:var(--pero-text-secondary); font:inherit; cursor:pointer; }
.pero-ui-toggle-item:not([data-unstyled])[data-state=on] { background:var(--pero-hover); color:var(--pero-text); }
.pero-ui-progress:not([data-unstyled]) { display:block; width:100%; max-width:100%; height:8px; border:0; border-radius:999px; overflow:hidden; background:color-mix(in srgb,var(--pero-text-secondary) 18%,var(--pero-surface)); accent-color:var(--pero-accent, var(--pero-focus)); }
.pero-ui-progress:not([data-unstyled])::-webkit-progress-bar { background:color-mix(in srgb,var(--pero-text-secondary) 18%,var(--pero-surface)); border-radius:999px; }
.pero-ui-progress:not([data-unstyled])::-webkit-progress-value { background:var(--pero-accent, var(--pero-focus)); border-radius:999px; }
.pero-ui-progress:not([data-unstyled])::-moz-progress-bar { background:var(--pero-accent, var(--pero-focus)); border-radius:999px; }
.pero-ui-stepper { display:flex; align-items:stretch; max-width:100%; margin:0; padding:var(--pero-space-2, 4px) var(--pero-space-1, 2px) var(--pero-space-5, 10px); list-style:none; overflow-x:auto; scroll-snap-type:x proximity; --stepper-accent:var(--pero-accent, #315be8); }
.pero-ui-stepper > li { display:flex; align-items:stretch; flex:none; scroll-snap-align:start; }
.pero-ui-stepper > li + li::before { content:"→"; align-self:center; flex:none; width:32px; text-align:center; color:var(--pero-text-secondary, #777); font-size:var(--pero-font-size-base, 14px); }
.pero-ui-stepper-node, .pero-ui-stepper-end > div { display:grid; align-content:start; gap:var(--pero-space-4, 8px); box-sizing:border-box; padding:var(--pero-space-6, 12px) var(--pero-space-7, 14px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle, #ddd); border-radius:var(--pero-radius-xl, 12px); background:var(--pero-surface, #fff); color:inherit; font:inherit; line-height:var(--pero-line-height-snug, 1.4); text-align:left; }
.pero-ui-stepper-node { position:relative; width:184px; min-height:0; height:auto; white-space:normal; cursor:pointer; box-shadow:inset 0 var(--pero-border-width-accent, 3px) 0 var(--node,var(--stepper-accent)); transition:border-color var(--pero-duration-base, .15s), background var(--pero-duration-base, .15s), box-shadow var(--pero-duration-medium, .2s), opacity var(--pero-duration-medium, .2s); }
.pero-ui-stepper-node:hover { background:var(--pero-hover, #f1f2f4); }
.pero-ui-stepper-node[aria-pressed=true] { border-color:var(--node,var(--stepper-accent)); background:color-mix(in srgb, var(--node,var(--stepper-accent)) 7%, var(--pero-surface, #fff)); }
.pero-ui-stepper-node:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-stepper-node[data-status=blocked], .pero-ui-stepper-node[data-status=failed] { border-style:dashed; border-color:color-mix(in srgb, var(--pero-warning, #b25e09) 55%, var(--pero-border-subtle, #ddd)); }
.pero-ui-stepper-node[data-status=active] { box-shadow:inset 0 var(--pero-border-width-accent, 3px) 0 var(--node,var(--stepper-accent)), 0 0 0 var(--pero-border-width-accent, 3px) color-mix(in srgb, var(--node,var(--stepper-accent)) 24%, transparent); }
.pero-ui-stepper-node[data-status=waiting] { box-shadow:inset 0 var(--pero-border-width-accent, 3px) 0 var(--node,var(--stepper-accent)), 0 0 0 var(--pero-border-width-accent, 3px) color-mix(in srgb, var(--node,var(--stepper-accent)) 32%, transparent); }
.pero-ui-stepper-item[data-dimmed] { opacity:.5; }
.pero-ui-stepper-head { display:flex; align-items:center; gap:var(--pero-space-4, 8px); font-size:var(--pero-font-size-xs-plus, 11.5px); }
.pero-ui-stepper-eyebrow { color:var(--node,var(--stepper-accent)); font-weight:var(--pero-font-weight-semibold, 600); }
.pero-ui-stepper-trailing { margin-left:auto; color:var(--pero-text-secondary, #777); font-size:var(--pero-font-size-xs, 11px); font-variant-numeric:tabular-nums; }
.pero-ui-stepper-node > strong { font-size:var(--pero-font-size-md-plus, 13.5px); font-weight:var(--pero-font-weight-semibold, 600); }
.pero-ui-stepper-badge { justify-self:start; padding:1px var(--pero-space-4, 8px); border-radius:var(--pero-radius-full, 999px); background:color-mix(in srgb, var(--node,var(--stepper-accent)) 16%, transparent); color:var(--node,var(--stepper-accent)); font-size:var(--pero-font-size-xs, 11px); font-weight:var(--pero-font-weight-semibold, 600); }
.pero-ui-stepper-footer { display:grid; gap:3px; padding-top:var(--pero-space-4, 8px); border-top:var(--pero-border-width-thin, 1px) dashed var(--pero-border-subtle, #ddd); color:var(--pero-text-secondary, #777); font-size:var(--pero-font-size-xs-plus, 11.5px); }
.pero-ui-stepper-end > div { min-width:150px; max-width:230px; border-style:dashed; background:var(--pero-hover, #f1f2f4); }
.pero-ui-stepper-end[data-end=end] > div { border-style:solid; border-color:color-mix(in srgb, var(--pero-success, #267a4b) 45%, var(--pero-border-subtle, #ddd)); }
/* pero-style-literal: the existing 5px tag radius is between token steps; preserve its geometry. */
.pero-ui-stepper-tag { justify-self:start; padding:1px var(--pero-space-4, 8px); border-radius:5px; background:var(--pero-text, #202124); color:var(--pero-surface, #fff); font:var(--pero-font-weight-bold, 700) var(--pero-font-size-xs, 11px) var(--dsw-font-mono,monospace); letter-spacing:.06em; }
.pero-ui-stepper-end[data-end=end] .pero-ui-stepper-tag { background:var(--pero-success, #267a4b); }
.pero-ui-stepper-end ul { display:grid; gap:var(--pero-space-3, 6px); margin:0; padding:0; list-style:none; }
.pero-ui-stepper-end li { display:grid; font-size:var(--pero-font-size-sm-plus, 12.5px); font-weight:550; line-height:var(--pero-line-height-snug, 1.4); }
.pero-ui-stepper-end small { color:var(--pero-text-secondary, #777); font-size:var(--pero-font-size-xs-plus, 11.5px); font-weight:var(--pero-font-weight-regular, 400); }
.pero-ui-stepper[data-view=fit] > li.pero-ui-stepper-item { flex:1 1 0; min-width:76px; }
.pero-ui-stepper[data-view=fit] > li + li::before { width:12px; font-size:var(--pero-font-size-xs, 11px); }
.pero-ui-stepper[data-view=fit] .pero-ui-stepper-node { width:100%; padding:7px var(--pero-space-4, 8px); gap:5px; }
.pero-ui-stepper[data-view=fit] .pero-ui-stepper-node > strong { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-size:var(--pero-font-size-sm, 12px); }
.pero-ui-stepper:is([data-view=fit], [data-view=focus]) :is(.pero-ui-stepper-footer, .pero-ui-stepper-badge) { display:none; }
.pero-ui-stepper[data-view=fit] .pero-ui-stepper-eyebrow { display:none; }
.pero-ui-stepper:is([data-view=fit], [data-view=focus]) .pero-ui-stepper-end > div { min-width:0; width:auto; max-width:92px; padding:7px var(--pero-space-4, 8px); gap:5px; }
.pero-ui-stepper:is([data-view=fit], [data-view=focus]) .pero-ui-stepper-end li { font-size:var(--pero-font-size-xs-plus, 11.5px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
.pero-ui-stepper:is([data-view=fit], [data-view=focus]) .pero-ui-stepper-end small { display:none; }
.pero-ui-stepper[data-view=focus] > li + li::before { width:14px; }
.pero-ui-stepper[data-view=focus] .pero-ui-stepper-node[aria-pressed=false] { width:auto; padding:7px var(--pero-space-4, 8px); gap:0; }
.pero-ui-stepper[data-view=focus] .pero-ui-stepper-node[aria-pressed=false] :is(.pero-ui-stepper-eyebrow, .pero-ui-stepper-footer, .pero-ui-stepper-badge) { display:none; }
.pero-ui-stepper[data-view=focus] .pero-ui-stepper-node[aria-pressed=false] > strong { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.pero-ui-stepper[data-view=focus] .pero-ui-stepper-node[aria-pressed=false] .pero-ui-stepper-head { gap:var(--pero-space-3, 6px); }
@media (prefers-reduced-motion: reduce) { .pero-ui-stepper-node { transition:none; } }
.pero-ui-checkbox:not([data-unstyled]):disabled, .pero-ui-radio-item:not([data-unstyled]):disabled, .pero-ui-tabs-trigger:not([data-unstyled]):disabled, .pero-ui-toggle-item:not([data-unstyled]):disabled { opacity:.5; cursor:default; }
.pero-ui-checkbox:focus-visible, .pero-ui-radio-item:focus-visible, .pero-ui-tabs-trigger:focus-visible, .pero-ui-tabs-content:focus-visible, .pero-ui-toggle-item:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-dropdown-content { z-index:1000; box-sizing:border-box; max-width:min(var(--radix-dropdown-menu-content-available-width,var(--radix-context-menu-content-available-width,calc(100vw - 16px))),calc(100vw - 16px)); max-height:var(--radix-dropdown-menu-content-available-height,var(--radix-context-menu-content-available-height,calc(100vh - 16px))); overflow:auto; }
.pero-ui-context-trigger:not([data-unstyled]) { display:contents; }
.pero-ui-dropdown-content:not([data-unstyled]) { min-width:min(200px,calc(100vw - 16px)); padding:5px; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:var(--pero-radius-xl, 12px); background:var(--pero-surface); color:var(--pero-text); font:inherit; font-size:var(--pero-font-size-md, 13px); box-shadow:0 14px 36px -8px var(--pero-domain-app-sdk-pero-ui-tooltip-shadow, rgb(0 0 0 / .2)); }
.pero-ui-dropdown-trigger:not([data-unstyled]) { min-height:var(--pero-size-control, 30px); padding:5px var(--pero-space-5, 10px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:7px; background:var(--pero-surface); color:var(--pero-text); font:inherit; cursor:pointer; }
.pero-ui-dropdown-item:not([data-unstyled]) { display:flex; align-items:center; gap:var(--pero-space-4, 8px); min-height:var(--pero-size-control, 30px); padding:0 var(--pero-space-5, 10px); border-radius:7px; outline:none; cursor:pointer; }
.pero-ui-dropdown-item:not([data-unstyled])[data-highlighted] { background:var(--pero-hover); }
.pero-ui-dropdown-item:not([data-unstyled])[data-danger] { color:var(--pero-danger); }
.pero-ui-dropdown-item:not([data-unstyled])[data-disabled], .pero-ui-dropdown-trigger:not([data-unstyled]):disabled { opacity:.5; cursor:default; }
.pero-ui-dropdown-indicator { display:inline-flex; align-items:center; justify-content:center; width:12px; flex:none; font-size:var(--pero-font-size-sm, 12px); }
.pero-ui-dropdown-separator:not([data-unstyled]) { height:1px; margin:var(--pero-space-2, 4px) var(--pero-space-1, 2px); background:var(--pero-border-subtle); }
.pero-ui-dropdown-sub-trigger:not([data-unstyled]) { justify-content:space-between; }
.pero-ui-dropdown-sub-chevron { margin-left:auto; }
.pero-ui-dropdown-label:not([data-unstyled]) { padding:var(--pero-space-2, 4px) var(--pero-space-5, 10px); color:var(--pero-muted); font-size:var(--pero-font-size-xs, 11px); }
.pero-ui-dropdown-trigger:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-split-pane-handle { width:9px; flex:none; cursor:col-resize; touch-action:none; position:relative; background:transparent; box-sizing:border-box; }
.pero-ui-split-pane-handle:not([data-unstyled])::before { content:''; position:absolute; inset:0; left:4px; width:1px; background:var(--pero-border-subtle); }
.pero-ui-split-pane-handle[data-orientation='horizontal'] { width:auto; height:9px; cursor:row-resize; }
.pero-ui-split-pane-handle[data-orientation='horizontal']:not([data-unstyled])::before { left:0; right:0; top:4px; bottom:auto; width:auto; height:1px; }
.pero-ui-split-pane-handle:not([data-unstyled]):hover, .pero-ui-split-pane-handle:not([data-unstyled]):focus-visible { background:color-mix(in srgb, var(--pero-focus) 20%, transparent); outline:none; }
.pero-ui-split-pane-handle:not([data-unstyled]):hover::before, .pero-ui-split-pane-handle:not([data-unstyled]):focus-visible::before { background:var(--pero-focus); }
.pero-ui-split-pane-handle:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-disclosure { min-width:0; }
.pero-ui-disclosure:not([data-unstyled]) { padding:var(--pero-space-5, 10px) var(--pero-space-6, 12px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:9px; color:var(--pero-text); }
.pero-ui-disclosure > summary { display:flex; align-items:baseline; gap:var(--pero-space-3, 6px); list-style:none; cursor:pointer; overflow-wrap:anywhere; }
.pero-ui-disclosure > summary::marker { content:''; }
.pero-ui-disclosure > summary::-webkit-details-marker { display:none; }
.pero-ui-disclosure > summary[data-no-indicator] { gap:0; }
.pero-ui-disclosure-indicator { display:inline-flex; align-self:center; flex:none; transform:rotate(0deg); }
.pero-ui-disclosure[open] > summary > .pero-ui-disclosure-indicator { transform:rotate(90deg); }
.pero-ui-disclosure > summary:dir(rtl) > .pero-ui-disclosure-indicator { transform:rotate(180deg); }
.pero-ui-disclosure[open] > summary:dir(rtl) > .pero-ui-disclosure-indicator { transform:rotate(90deg); }
.pero-ui-disclosure > summary:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-card { min-width:0; }
.pero-ui-card:not([data-unstyled]) { box-sizing:border-box; padding:var(--pero-card-padding,16px); border:var(--pero-border-width-thin, 1px) solid var(--pero-card-border-color,var(--pero-border-subtle, #ddd)); border-radius:var(--pero-radius-xl, 12px); background:var(--pero-card-background,var(--pero-surface, #fff)); color:var(--pero-text); overflow-wrap:anywhere; }
.pero-ui-card-header:not([data-unstyled]) { display:flex; align-items:center; justify-content:space-between; gap:var(--pero-space-6, 12px); flex-wrap:wrap; min-width:0; }
.pero-ui-card-actions:not([data-unstyled]) { display:flex; align-items:center; flex-wrap:wrap; gap:var(--pero-space-3, 6px); min-width:0; }

.pero-ui-table-wrap { min-width:0; max-width:100%; overflow-x:auto; }
.pero-ui-table-wrap:not([data-unstyled]) { border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle, #ddd); border-radius:var(--pero-radius-sm, 6px); background:var(--pero-surface, #fff); }
.pero-ui-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:var(--pero-font-size-sm, 12px); color:var(--pero-text); }
.pero-ui-table thead th { background:var(--pero-surface-muted, #f7f8fa); color:var(--pero-text-secondary); font-size:var(--pero-font-size-xs, 11px); font-weight:var(--pero-font-weight-medium, 500); text-align:left; padding:var(--pero-space-5, 10px) var(--pero-space-6, 12px); white-space:nowrap; }
.pero-ui-table tbody th, .pero-ui-table td { padding:var(--pero-space-6, 12px); border-top:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle, #ddd); vertical-align:top; color:var(--pero-text-secondary); background:transparent; font-weight:inherit; font-size:inherit; text-align:left; overflow:hidden; }
.pero-ui-table tbody th { color:var(--pero-text); }
.pero-ui-table-wrap[data-density=compact] .pero-ui-table :is(th,td) { padding:var(--pero-space-2,4px) var(--pero-space-4,8px); vertical-align:middle; }
.pero-ui-table [data-align=end] { text-align:right; }
.pero-ui-table [data-nowrap] { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pero-ui-table tbody tr:hover th, .pero-ui-table tbody tr:hover td { background:var(--pero-surface-muted, #f7f8fa); }
.pero-ui-table:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }

.pero-ui-result { min-width:0; display:grid; gap:var(--pero-space-4, 8px); font-size:var(--pero-font-size-md, 13px); color:var(--pero-text); }
.pero-ui-result[data-state=loading] { color:var(--pero-text-secondary); }
.pero-ui-result-skeleton { height:72px; border-radius:var(--pero-radius-md, 8px); background:var(--pero-hover); }
@media (prefers-reduced-motion: no-preference) { .pero-ui-result-skeleton { animation: pero-ui-result-pulse 1.4s ease-in-out infinite; } }
@keyframes pero-ui-result-pulse { 50% { opacity:.5; } }
.pero-ui-result[data-state=error], .pero-ui-result[data-state=invalid] { padding:var(--pero-space-5, 10px) var(--pero-space-6, 12px); border:var(--pero-border-width-thin, 1px) solid var(--pero-danger); border-radius:var(--pero-radius-md, 8px); color:var(--pero-danger); }
.pero-ui-result-scroll { max-width:100%; overflow:auto; max-height:420px; border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:var(--pero-radius-md, 8px); }
.pero-ui-result-scroll:focus-visible, .pero-ui-result-ref:focus-visible { outline:var(--pero-focus-ring-width, 2px) solid var(--pero-focus); outline-offset:var(--pero-focus-ring-offset, 2px); }
.pero-ui-result table { width:100%; border-collapse:collapse; }
.pero-ui-result caption { padding:var(--pero-space-4, 8px) var(--pero-space-5, 10px); text-align:left; font-weight:var(--pero-font-weight-semibold, 600); }
.pero-ui-result th, .pero-ui-result td { padding:5px var(--pero-space-5, 10px); border-top:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); text-align:left; vertical-align:top; overflow-wrap:anywhere; }
.pero-ui-result thead th { position:sticky; top:0; background:var(--pero-surface); font-weight:var(--pero-font-weight-semibold, 600); }
.pero-ui-result td[data-numeric] { text-align:right; font-variant-numeric:tabular-nums; }
.pero-ui-result-title { margin:0; font-size:var(--pero-font-size-md-plus, 13.5px); font-weight:var(--pero-font-weight-semibold, 600); }
.pero-ui-result-chart { width:100%; height:auto; aspect-ratio:8/3; }
.pero-ui-result-chart, .pero-ui-result-legend { --pero-ui-series: var(--pero-chart-1); --pero-ui-dash: none; }
.pero-ui-result [data-series="0"] { --pero-ui-series: var(--pero-chart-1); --pero-ui-dash: none; }
.pero-ui-result [data-series="1"] { --pero-ui-series: var(--pero-chart-2); --pero-ui-dash: 7 4; }
.pero-ui-result [data-series="2"] { --pero-ui-series: var(--pero-chart-3); --pero-ui-dash: 2 3; }
.pero-ui-result [data-series="3"] { --pero-ui-series: var(--pero-chart-4); --pero-ui-dash: 11 4 2 4; }
.pero-ui-result [data-series="4"] { --pero-ui-series: var(--pero-chart-5); --pero-ui-dash: 4 3 1 3; }
.pero-ui-result [data-series="5"] { --pero-ui-series: var(--pero-chart-6); --pero-ui-dash: 9 3; }
.pero-ui-result-chart rect, .pero-ui-result-legend rect { fill:var(--pero-ui-series); }
.pero-ui-result-chart path, .pero-ui-result-legend line { fill:none; stroke:var(--pero-ui-series); stroke-width:2; stroke-dasharray:var(--pero-ui-dash); vector-effect:non-scaling-stroke; }
/* Series differ by colour, by dash (lines) and by the legend's text: never by colour alone. */
.pero-ui-result-legend { display:flex; flex-wrap:wrap; gap:var(--pero-space-2, 4px) var(--pero-space-7, 14px); margin:var(--pero-space-2, 4px) 0 0; padding:0; list-style:none; font-size:var(--pero-font-size-sm, 12px); color:var(--pero-text-secondary); }
.pero-ui-result-legend li { display:inline-flex; align-items:center; gap:var(--pero-space-3, 6px); }
.pero-ui-result-axis { stroke:var(--pero-border-subtle); }
.pero-ui-result-tick { fill:var(--pero-text-secondary); font-size:var(--pero-font-size-xs, 11px); }
.pero-ui-result-source, .pero-ui-result-notice, .pero-ui-result-empty { margin:0; color:var(--pero-text-secondary); display:flex; flex-wrap:wrap; gap:var(--pero-space-3, 6px); align-items:center; overflow-wrap:anywhere; }
.pero-ui-result-empty { padding:var(--pero-space-5, 10px); }
.pero-ui-result-badge { padding:1px var(--pero-space-3, 6px); border:var(--pero-border-width-thin, 1px) solid currentColor; border-radius:var(--pero-radius-full, 999px); font-size:var(--pero-font-size-xs-plus, 11.5px); }
.pero-ui-result-source[data-provenance=illustrative] .pero-ui-result-badge { color:var(--pero-warning); }
.pero-ui-result-ref { padding:0; border:0; background:none; color:var(--pero-accent); font:inherit; text-decoration:underline; cursor:pointer; }
.pero-ui-result-plot { min-width:0; }
.pero-ui-result-xticks { display:grid; margin:var(--pero-space-1, 2px) 0 0; padding-top:0; padding-bottom:0; list-style:none; color:var(--pero-text-secondary); font-size:var(--pero-font-size-xs, 11px); line-height:var(--pero-line-height-tight, 1.3); text-align:center; }
.pero-ui-result-xticks li { min-width:0; padding:0 var(--pero-space-1, 2px); overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pero-ui-visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.pero-ui-result-data summary { cursor:pointer; color:var(--pero-text-secondary); }
.pero-ui-loading { min-width:0; container:pero-ui-loading / inline-size; }
.pero-ui-loading-label { margin:0 0 var(--pero-space-9, 18px); color:var(--pero-text-secondary); font-size:var(--pero-font-size-sm, 12px); line-height:var(--pero-line-height-normal, 1.5); overflow-wrap:anywhere; }
.pero-ui-loading-shapes { min-width:0; pointer-events:none; animation:pero-ui-skeleton-breathe 2s ease-in-out infinite; }
.pero-ui-skeleton-block { display:block; max-width:100%; height:10px; border-radius:var(--pero-radius-xs, 4px); background:color-mix(in srgb,var(--pero-text-secondary) 14%,var(--pero-surface)); flex:none; }
.pero-ui-skeleton-block--title { height:17px; border-radius:5px; }
.pero-ui-skeleton-block--icon { height:20px; border-radius:5px; }
.pero-ui-skeleton-block--surface { height:180px; border-radius:var(--pero-radius-lg, 10px); background:color-mix(in srgb,var(--pero-text-secondary) 7%,var(--pero-surface)); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); box-sizing:border-box; }
.pero-ui-skeleton-text { display:grid; gap:var(--pero-space-6, 12px); min-width:0; }
.pero-ui-skeleton-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--pero-space-8, 16px); }
.pero-ui-skeleton-card { display:grid; gap:var(--pero-space-9, 18px); padding:var(--pero-space-10, 20px); border:var(--pero-border-width-thin, 1px) solid var(--pero-border-subtle); border-radius:var(--pero-radius-xl, 12px); min-width:0; }
.pero-ui-skeleton-footer { display:flex; justify-content:space-between; align-items:center; gap:var(--pero-space-8, 16px); margin-top:var(--pero-space-4, 8px); }
@keyframes pero-ui-skeleton-breathe { 0%,100%{opacity:1} 50%{opacity:.55} }
@container pero-ui-loading (max-width:560px) { .pero-ui-skeleton-cards { grid-template-columns:minmax(0,1fr); } .pero-ui-skeleton-card { padding:var(--pero-space-8, 16px); } }
@media (prefers-reduced-motion: reduce) { .pero-ui-loading-shapes { animation:none; } }
/* Minimum hit area: small controls keep their drawn size but take pointer input over at least --pero-size-hit-min (24px) in every style. */
.pero-ui-help-tip-button, .pero-ui-checkbox:not([data-unstyled]), .pero-ui-radio-item:not([data-unstyled]), .pero-ui-switch:not([data-unstyled]) { position: relative; }
.pero-ui-help-tip-button::after, .pero-ui-checkbox:not([data-unstyled])::after, .pero-ui-radio-item:not([data-unstyled])::after, .pero-ui-switch:not([data-unstyled])::after { content: ""; position: absolute; top: 50%; left: 50%; width: max(100%, var(--pero-size-hit-min, 24px)); height: max(100%, var(--pero-size-hit-min, 24px)); transform: translate(-50%, -50%); }
`;

/** Same-document Apps share one style element, scoped to Pero controls. */
export function ensureUiStyles(doc: Document) {
  ensureDesignTokens(doc);
  if (doc.getElementById('pero-app-ui-styles')) return;
  const style = doc.createElement('style');
  style.id = 'pero-app-ui-styles';
  style.textContent = uiStyles;
  doc.head.append(style);
}
