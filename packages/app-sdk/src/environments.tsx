import React, { useEffect, useRef } from 'react';
import { useAppContext } from './index';
import { mountEnvironmentView, mountEnvironmentInspector, type ScientificMethod } from './environments/view.mjs';
import { mountEnvironmentManager } from './environments/manager.mjs';
import './environments/styles.css';

export type { ScientificMethod } from './environments/view.mjs';
/** Managed local environments; task inspectors keep their scoped observation view. */
export function EnvironmentBrowser() {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof mountEnvironmentManager> | null>(null);
  const { locale } = useAppContext();
  useEffect(() => {
    const mounted = mountEnvironmentManager(root.current!, { locale, inspect: mountEnvironmentView }); view.current = mounted;
    return () => { mounted.dispose(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.setLocale(locale); }, [locale]);
  return <div ref={root} />;
}

/** Opens in the existing task. It never changes the selected scientific runtime. */
export function EnvironmentInspector({ targets }: { targets: readonly ScientificMethod[] }) {
  const root = useRef<HTMLSpanElement>(null);
  const { locale } = useAppContext();
  const scope = targets.join('|');
  useEffect(() => {
    const mounted = mountEnvironmentInspector(root.current!, { targets, locale });
    return () => mounted.dispose();
  }, [scope, locale]);
  return <span ref={root} />;
}
