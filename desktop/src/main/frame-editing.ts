/** Edit shortcuts for an App iframe. The window menu acts on the top frame, so Cmd/Ctrl+C/V never reach pero-app://. */

export type FrameKey = { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean };
export type FrameEdit = 'copy' | 'cut' | 'paste' | 'selectAll';

export function appFrameEdit(input: FrameKey, frameUrl: string | undefined, platform: NodeJS.Platform): FrameEdit | null {
  if (input.type !== 'keyDown' || input.alt || input.shift || !frameUrl?.startsWith('pero-app://')) return null;
  const primary = platform === 'darwin' ? input.meta : input.control;
  if (!primary) return null;
  const key = input.key.toLowerCase();
  if (key === 'c') return 'copy';
  if (key === 'x') return 'cut';
  if (key === 'v') return 'paste';
  if (key === 'a') return 'selectAll';
  return null;
}

export function bindAppFrameEditing(contents: Electron.WebContents) {
  contents.on('before-input-event', (event, input) => {
    const action = appFrameEdit(input, contents.focusedFrame?.url, process.platform);
    if (!action) return;
    contents[action]();
    event.preventDefault();
  });
}
