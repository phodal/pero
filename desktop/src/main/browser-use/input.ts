import type { WebContents } from 'electron';

// Chromium key codes and dispatch order adapted from Point's BrowserHost.
const virtualKey = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, Space: 32,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
} as const;
export type BrowserKey = keyof typeof virtualKey;
export const BROWSER_KEYS = Object.keys(virtualKey) as BrowserKey[];
export const BROWSER_MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'] as const;
export type BrowserModifier = typeof BROWSER_MODIFIERS[number];

export type ViewportPoint = { x: number; y: number };
export type BrowserInput =
  | { kind: 'click'; point: ViewportPoint; count?: 1 | 2 }
  | { kind: 'dblclick'; point: ViewportPoint; checkSecondClick(): Promise<void> }
  | { kind: 'hover'; point: ViewportPoint }
  | { kind: 'press'; key: string; modifiers?: BrowserModifier[] }
  | { kind: 'typeSequentially'; text: string; checkTarget(): Promise<void> }
  | { kind: 'scroll'; point: ViewportPoint; deltaX: number; deltaY: number };

/** Fixed browser commands for this WebContents only. This attachment never adopts DevTools. */
export async function dispatchBrowserInput(contents: WebContents, input: BrowserInput) {
  const client = contents.debugger;
  client.attach('1.3');
  try {
    await sendBrowserInput((method, params) => client.sendCommand(method, params), () => !contents.isDestroyed() && client.isAttached(), input);
  } finally {
    if (!contents.isDestroyed() && client.isAttached()) client.detach();
  }
}

export async function sendBrowserInput(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  attached: () => boolean,
  input: BrowserInput,
) {
  if (input.kind === 'click' || input.kind === 'dblclick') {
    const clicks = input.kind === 'dblclick' ? [1, 2] : [input.count ?? 1];
    for (const clickCount of clicks) {
      if (input.kind === 'dblclick' && clickCount === 2) await input.checkSecondClick();
      const button = { ...input.point, button: 'left', clickCount };
      try {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button });
      } finally {
        if (attached())
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button });
      }
    }
  } else if (input.kind === 'hover') {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...input.point });
  } else if (input.kind === 'press' || input.kind === 'typeSequentially') {
    const keys = input.kind === 'press' ? [input.key] : [...input.text];
    const modifiers = input.kind === 'press' ? BROWSER_MODIFIERS.reduce((mask, key, index) =>
      mask | (input.modifiers?.includes(key) ? 1 << index : 0), 0) : 0;
    for (const [index, value] of keys.entries()) {
      if (index && input.kind === 'typeSequentially') await input.checkTarget();
      const upper = value.toUpperCase();
      const namedKey = virtualKey[value as BrowserKey];
      const space = value === ' ' || value === 'Space';
      const key = space ? ' ' : modifiers & 8 && !namedKey ? upper : value;
      const payload = { key, modifiers, code: space ? 'Space' : namedKey ? value : /^[0-9]$/.test(value) ? `Digit${value}` : `Key${upper}`,
        windowsVirtualKeyCode: space ? 32 : namedKey ?? upper.charCodeAt(0) };
      try {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...payload,
          ...(key.length === 1 && !(modifiers & 7) && { text: key }) });
      } finally {
        if (attached()) await send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload });
      }
    }
  } else {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', ...input.point, deltaX: input.deltaX, deltaY: input.deltaY,
    });
  }
}
