import { app, type BrowserWindowConstructorOptions } from 'electron';

// Only the test launcher opts in; ordinary Desktop launches keep native behavior.
export const backgroundTest = process.env.PERO_TEST_BACKGROUND === '1';
if (backgroundTest && process.platform === 'darwin') app.setActivationPolicy('accessory');

export const testWindowOptions: BrowserWindowConstructorOptions = backgroundTest
  ? { show: false, webPreferences: { backgroundThrottling: false } }
  : {};
