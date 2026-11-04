import React, { useEffect, useRef } from 'react';
import { useAppContext } from './index';
import { mountEnvironmentView, mountEnvironmentInspector, type ScientificMethod } from './environments/view.mjs';
import './environments/styles.css';

export type { ScientificMethod } from './environments/view.mjs';
/** A Host-backed read-only projection, shared by three consumers. */
export function EnvironmentBrowser() {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof mountEnvironmentView> | null>(null);
  const { locale } = useAppContext();
  useEffect(() => {
    const mounted = mountEnvironmentView(root.current!, { locale }); view.current = mounted;
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
