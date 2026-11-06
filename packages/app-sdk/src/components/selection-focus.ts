import React, { useState } from 'react';

/** Pointer selection and keyboard focus are independent for roving controls. */
export function useSelectionFocus({ onPointerDown, onKeyDown, onBlur }: Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerDown' | 'onKeyDown' | 'onBlur'>) {
  // WebKit can retain :focus-visible after Radix focuses a pointer-selected item.
  const [pointerFocus, setPointerFocus] = useState(false);
  return {
    'data-pointer-focus': pointerFocus || undefined,
    onPointerDown(event: React.PointerEvent<HTMLButtonElement>) { setPointerFocus(true); onPointerDown?.(event); },
    onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) { setPointerFocus(false); onKeyDown?.(event); },
    onBlur(event: React.FocusEvent<HTMLButtonElement>) { setPointerFocus(false); onBlur?.(event); },
  };
}
