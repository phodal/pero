export type CanvasFocus = 'composer-input' | 'pane-iframe' | 'tool-iframe' | 'canvas';

/**
 * A canvas press may move DOM focus to the composer input only when GPUI has
 * the composer focused and the active iframe is not an App pane GPUI just
 * focused. That pane keeps the keyboard.
 */
export function reclaimAfterCanvasPress(state: {
  composerFocused: boolean;
  active: CanvasFocus;
  paneFocused: boolean;
}): CanvasFocus {
  if (state.active === 'pane-iframe' && state.paneFocused) return 'pane-iframe';
  if (state.composerFocused && state.active === 'tool-iframe') return 'composer-input';
  return state.active;
}
