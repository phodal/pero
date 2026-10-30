import { desktopCapturer, shell, systemPreferences } from 'electron';

/** Called only by a trusted Settings/menu gesture, never by the model tool. */
export async function computerPermissions() {
  if (process.platform !== 'darwin') return;
  const accessibility = systemPreferences.isTrustedAccessibilityClient(true);
  await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  const pane = !accessibility ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}
