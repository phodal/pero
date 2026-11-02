// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import { ensureDesignTokens } from '../tokens/ensure-tokens.mjs';
export const selectStyles = `
.pero-select{display:inline-flex;min-width:0;max-width:100%;vertical-align:middle}
.pero-select .pero-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:var(--pero-space-4, 8px);box-sizing:border-box;width:100%;min-width:0;min-height:var(--pero-size-control, 30px);padding:var(--pero-space-2, 4px) var(--pero-space-4, 8px);border:var(--pero-border-width-thin, 1px) solid var(--pero-select-border,var(--pero-border-control,#d9dce2));border-radius:7px;background:var(--pero-select-bg,var(--pero-surface,#fff));color:var(--pero-select-ink,var(--pero-text,#202124));font:inherit;font-size:var(--pero-font-size-md, 13px);text-align:left;cursor:pointer;-webkit-app-region:no-drag}
.pero-select-trigger>.pero-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pero-select-trigger svg,.pero-select-trailing{flex:none}
.pero-select-trailing{display:inline-flex;align-items:center}
.pero-select-trigger:disabled{opacity:.5;cursor:default}
.pero-select-trigger[aria-invalid=true]{border-color:var(--pero-danger, #b42318)}
.pero-select-trigger:focus-visible,.pero-select-trigger[aria-expanded=true]{outline:var(--pero-focus-ring-width, 2px) solid var(--pero-select-accent,var(--pero-focus));outline-offset:var(--pero-focus-ring-offset, 2px)}
.pero-select-panel{position:fixed;z-index:1000;box-sizing:border-box;display:flex;flex-direction:column;padding:5px;border:var(--pero-border-width-thin, 1px) solid var(--pero-select-border);border-radius:var(--pero-radius-lg, 10px);background:var(--pero-select-bg);color:var(--pero-select-ink);font-size:var(--pero-font-size-md, 13px);box-shadow:0 12px 32px -8px var(--pero-domain-app-sdk-pero-select-panel-shadow, rgb(0 0 0 / .25));overflow:hidden;-webkit-app-region:no-drag}
.pero-select-search{box-sizing:border-box;flex:none;width:100%;min-height:32px;margin:0 0 5px;padding:5px var(--pero-space-4, 8px);border:var(--pero-border-width-thin, 1px) solid var(--pero-select-border);border-radius:var(--pero-radius-sm, 6px);background:var(--pero-select-bg);color:inherit;font:inherit}
.pero-select-search:focus-visible,.pero-select-list:focus-visible{outline:var(--pero-focus-ring-width, 2px) solid var(--pero-select-accent);outline-offset:-2px}
.pero-select-list{flex:1 1 auto;overflow:auto;min-height:0;overscroll-behavior:contain}
.pero-select-group-label{padding:var(--pero-space-4, 8px) var(--pero-space-4, 8px) var(--pero-space-2, 4px);color:var(--pero-select-muted);font-size:var(--pero-font-size-sm, 12px);font-weight:var(--pero-font-weight-medium, 500)}
.pero-select-option{display:flex;align-items:center;gap:var(--pero-space-4, 8px);min-height:32px;box-sizing:border-box;padding:var(--pero-space-3, 6px) var(--pero-space-4, 8px);border-radius:var(--pero-radius-sm, 6px);cursor:pointer}
.pero-select-option[data-depth="1"]{padding-inline-start:calc(var(--pero-space-4, 8px) + 1.15em)}
.pero-select-option[data-depth="1"]::before{content:"└";flex:none;color:var(--pero-select-muted);font-size:var(--pero-font-size-sm, 12px);line-height:1}
.pero-select-option[data-depth="2"]{padding-inline-start:calc(var(--pero-space-4, 8px) + 2.3em)}
.pero-select-option[data-depth="2"]::before{content:"└";flex:none;color:var(--pero-select-muted);font-size:var(--pero-font-size-sm, 12px);line-height:1}
.pero-select-option>span{flex:1;min-width:0;overflow-wrap:anywhere}
.pero-select-option-copy{display:flex;flex-direction:column;gap:1px}
.pero-select-option-copy>span,.pero-select-option-copy>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.pero-select-option-copy>small{color:var(--pero-select-muted);font-size:var(--pero-font-size-sm, 12px);font-weight:var(--pero-font-weight-regular, 400)}
.pero-select-option svg{flex:none}
.pero-select-footer{display:flex;flex:0 0 auto;flex-direction:column;gap:2px;margin-top:4px;padding-top:4px;border-top:1px solid var(--pero-select-border)}
.pero-select-footer .pero-ui-button{width:100%;justify-content:flex-start;white-space:normal;text-align:left}
.pero-select-option[data-active=true]{background:var(--pero-select-hover)}
.pero-select-option[aria-selected=true]{color:var(--pero-select-accent);font-weight:var(--pero-font-weight-semibold, 600)}
.pero-select-option[aria-disabled=true]{opacity:.5;cursor:default}
.pero-select-empty{margin:0;padding:var(--pero-space-5, 10px) var(--pero-space-4, 8px);color:var(--pero-select-muted)}
@media(pointer:coarse){.pero-select-trigger,.pero-select-option{min-height:44px}}
`;

export function ensureSelectStyles(doc) {
  ensureDesignTokens(doc);
  if (doc.getElementById('pero-select-styles')) return;
  const style = doc.createElement('style');
  style.id = 'pero-select-styles';
  style.textContent = selectStyles;
  doc.head.append(style);
}
