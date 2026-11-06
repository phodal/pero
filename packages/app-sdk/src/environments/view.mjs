import React from 'react';
import { createRoot } from 'react-dom/client';
import { EnvironmentChecks, EnvironmentInspectorAction } from './inspection';

/** Compatibility mounts share the same production composition and session lifetime. */
export function mountEnvironmentView(root, options = {}) {
  const mounted = createRoot(root);
  let locale = options.locale || 'en';
  const render = () => mounted.render(React.createElement(EnvironmentChecks, { ...options, locale }));
  render();
  return { setLocale(value) { locale = value; render(); }, dispose() { mounted.unmount(); } };
}
export function mountEnvironmentInspector(root, options = {}) {
  const mounted = createRoot(root);
  mounted.render(React.createElement(EnvironmentInspectorAction, options));
  return { dispose() { mounted.unmount(); } };
}
