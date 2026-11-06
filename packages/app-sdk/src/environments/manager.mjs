import React from 'react';
import { createRoot } from 'react-dom/client';
import { EnvironmentManager } from './workspace';

/** Compatibility mount; the actual workspace uses the shared React controls. */
export function mountEnvironmentManager(root, options = {}) {
  const mounted = createRoot(root);
  let locale = options.locale || 'en';
  const render = () => mounted.render(React.createElement(EnvironmentManager, { locale }));
  render();
  return { setLocale(value) { locale = value; render(); }, dispose() { mounted.unmount(); } };
}
