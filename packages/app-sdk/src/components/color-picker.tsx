// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { useEffect, useId, useState } from 'react';
import { Icon } from './icon';
import { Input } from './input';
import { Popover } from './popover';
import { ensureUiStyles } from './ui-styles';

export type ColorPickerPreset = {
  value: string;
  label: string;
  /** CSS color for the swatch; defaults to `value` when that is already a paint color. */
  color?: string;
};

export type ColorPickerProps = {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  presets?: readonly ColorPickerPreset[];
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  triggerClassName?: string;
  trigger?: React.ReactNode;
  clearLabel?: string;
  customLabel?: string;
  hexLabel?: string;
  allowClear?: boolean;
  title?: string;
  align?: 'start' | 'end';
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalize #rgb / #rrggbb. Rejects urls, expressions and other CSS functions. */
export function normalizeHexColor(value: string): string | null {
  const raw = value.trim();
  if (!HEX.test(raw) || /url\s*\(|expression\s*\(|attr\s*\(/i.test(raw)) return null;
  if (raw.length === 4) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return raw.toLowerCase();
}

function previewColor(value: string | null, presets: readonly ColorPickerPreset[] | undefined): string | undefined {
  if (!value) return undefined;
  const preset = presets?.find(item => item.value === value);
  if (preset?.color) return preset.color;
  return normalizeHexColor(value) ?? (preset ? undefined : value);
}

/**
 * Preset swatches plus a native color well and hex field. The consumer owns
 * which preset values mean theme tokens versus concrete paints.
 */
export function ColorPicker({
  label, value, onChange, presets = [], disabled = false, className, contentClassName, triggerClassName,
  trigger, clearLabel = 'Default', customLabel = 'Custom', hexLabel = 'Hex', allowClear = true,
  title, align = 'start',
}: ColorPickerProps) {
  const hexId = useId();
  const nativeId = useId();
  const selected = value ?? '';
  const paint = previewColor(value, presets) ?? '#000000';
  const hexValue = normalizeHexColor(paint) ?? '#000000';
  const [draft, setDraft] = useState(hexValue);
  useEffect(() => { setDraft(hexValue); }, [hexValue]);

  const commitHex = (next: string, close?: () => void) => {
    const color = normalizeHexColor(next);
    if (!color) return false;
    onChange(color);
    close?.();
    return true;
  };

  return <Popover label={label} triggerTitle={title ?? label} disabled={disabled} align={align} className={['pero-ui-color-picker', className].filter(Boolean).join(' ')}
    triggerClassName={['pero-ui-color-picker-trigger', triggerClassName].filter(Boolean).join(' ')} contentClassName={['pero-ui-color-picker-panel', contentClassName].filter(Boolean).join(' ')}
    trigger={trigger ?? <span className="pero-ui-color-picker-glyph" style={{ color: paint }} aria-hidden="true">A</span>}>
    {close => <>
      {allowClear && <button type="button" className="pero-ui-color-picker-option" data-selected={!selected || undefined}
        onClick={() => { onChange(null); close(); }}>
        <span className="pero-ui-color-picker-swatch" data-empty="" aria-hidden="true" />
        <span className="pero-ui-color-picker-option-label">{clearLabel}</span>
        {!selected && <Icon name="check" size={14} strokeWidth={2} />}
      </button>}
      {presets.map(preset => {
        const swatch = preset.color ?? normalizeHexColor(preset.value) ?? preset.value;
        return <button key={preset.value} type="button" className="pero-ui-color-picker-option" data-selected={selected === preset.value || undefined}
          onClick={() => { onChange(preset.value); close(); }}>
          <span className="pero-ui-color-picker-swatch" style={{ background: swatch }} aria-hidden="true" />
          <span className="pero-ui-color-picker-option-label">{preset.label}</span>
          {selected === preset.value && <Icon name="check" size={14} strokeWidth={2} />}
        </button>;
      })}
      <div className="pero-ui-color-picker-custom">
        <span className="pero-ui-color-picker-custom-label">{customLabel}</span>
        <div className="pero-ui-color-picker-custom-row">
          <input id={nativeId} className="pero-ui-color-picker-native" type="color" value={hexValue} aria-label={customLabel}
            onChange={event => {
              const color = normalizeHexColor(event.target.value);
              if (color) { setDraft(color); onChange(color); }
            }}
            ref={node => { if (node) ensureUiStyles(node.ownerDocument); }} />
          <label className="pero-ui-color-picker-hex" htmlFor={hexId}>
            <span className="pero-ui-color-picker-hex-caption">{hexLabel}</span>
            <Input id={hexId} value={draft} spellCheck={false} autoComplete="off" maxLength={7}
              aria-invalid={draft.length > 0 && !normalizeHexColor(draft) || undefined}
              onChange={event => setDraft(event.target.value)}
              onBlur={() => { if (!commitHex(draft)) setDraft(hexValue); }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (commitHex(draft, close)) return;
                  setDraft(hexValue);
                }
              }} />
          </label>
        </div>
      </div>
    </>}
  </Popover>;
}
