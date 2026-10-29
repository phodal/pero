import { _electron } from '@playwright/test';

export const headed = process.env.PERO_TEST_HEADED === '1';

// Renderer focus is enough for CDP keyboard/IME events; it must not activate macOS.
export async function focusPage(page) {
  if (headed) return page.bringToFront();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.detach();
}

export const electron = {
  async launch(options = {}) {
    const { requiresNativeWindow = false, ...launchOptions } = options;
    if (requiresNativeWindow && !headed) {
      throw new Error('This suite verifies native window visibility. Run with PERO_TEST_HEADED=1 in an isolated desktop (Linux: xvfb-run -a), so it does not interrupt your desktop.');
    }
    const env = { ...(launchOptions.env ?? process.env), PERO_TEST_BACKGROUND: headed ? '0' : '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = [...(launchOptions.args ?? [])];
    if (process.env.PERO_TEST_SOFTWARE_GL === '1') {
      args.push('--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader');
    }
    const app = await _electron.launch({ ...launchOptions, args, env });
    try {
      if (!headed) {
        const page = await app.firstWindow();
        const visible = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(window => window.isVisible() || window.isFocused()));
        if (visible) throw new Error('Background Electron opened a native window. Rebuild Desktop (or the Product) before testing. Use PERO_TEST_HEADED=1 for explicit foreground acceptance.');
        await focusPage(page);
      }
      return app;
    } catch (error) {
      await app.close();
      throw error;
    }
  },
};
