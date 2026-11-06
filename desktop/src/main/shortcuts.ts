/** Only app entry commands cross an embedded frame. GPUI handles the top frame. */
import type { CommandId, ShortcutMenu } from '../../../protocol/generated/shortcuts';
import type { FrameKey } from './frame-editing';

export function embeddedShortcut(menu: ShortcutMenu, input: FrameKey & { isAutoRepeat?: boolean; isComposing?: boolean }, frameUrl: string | undefined): CommandId | undefined {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing || !frameUrl?.startsWith('pero-app://')) return;
  for (const entry of menu.entries) {
    if (!entry.application_entry) continue;
    for (const accelerator of entry.accelerators) {
      const parts = accelerator.toLowerCase().split('+');
      const key = parts.pop();
      const actual = input.key.toLowerCase().replace(/^arrow/, '');
      const expected = key === 'plus' ? '+' : key === 'minus' ? '-' : key === 'space' ? ' ' : key;
      if (actual === expected && !!input.meta === parts.includes('super') &&
          !!input.control === parts.includes('control') && !!input.alt === parts.includes('alt') && !!input.shift === parts.includes('shift')) {
        return entry.command;
      }
    }
  }
}
