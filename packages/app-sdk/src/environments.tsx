import React from 'react';
import { useAppContext } from './index';
import { EnvironmentManager } from './environments/workspace';
import { EnvironmentInspectorAction } from './environments/inspection';
import type { ScientificMethod } from './environments/view.mjs';
import './environments/styles.css';

export type { ScientificMethod } from './environments/view.mjs';
/** Managed local environments; preparation and binding remain Host-owned. */
export function EnvironmentBrowser() {
  const { locale } = useAppContext();
  return <EnvironmentManager locale={locale} />;
}

/** Task-scoped observation never changes the selected scientific runtime. */
export function EnvironmentInspector({ targets }: { targets: readonly ScientificMethod[] }) {
  const { locale } = useAppContext();
  return <EnvironmentInspectorAction targets={targets} locale={locale} />;
}
