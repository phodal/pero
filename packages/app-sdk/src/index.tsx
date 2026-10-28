import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import themes from '../../../web/src/theme.generated.json';
import './ui.css';

export type AppContext = { locale: 'en' | 'zh-CN'; dark: boolean; active: boolean };
const Context = createContext<AppContext>({ locale: 'en', dark: false, active: true });

/** The parent owns context; the App frame never receives Desktop credentials. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<AppContext>({ locale: 'en', dark: false, active: true });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:context') return;
      const value = event.data.context;
      if (!value || !['en', 'zh-CN'].includes(value.locale) || typeof value.dark !== 'boolean' || typeof value.active !== 'boolean') return;
      setContext({ locale: value.locale, dark: value.dark, active: value.active });
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:ready' }, '*');
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    document.documentElement.lang = context.locale;
    document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
    for (const [key, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${key}`, value);
    document.documentElement.style.setProperty('--pero-text-secondary', (context.dark ? themes.dark : themes.light)['text-muted']);
    document.documentElement.style.setProperty('--pero-border-subtle', (context.dark ? themes.dark : themes.light).border);
  }, [context.locale, context.dark]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export const useAppInfo = () => ({ active: useContext(Context).active });
export const useTheme = () => ({ id: 'pero', mode: useContext(Context).dark ? 'dark' : 'light' });
export function useAppI18n<M extends Record<string, { zh: string; en: string }>>(messages: M) {
  const { locale } = useContext(Context);
  return { t: (key: keyof M) => messages[key]?.[locale === 'zh-CN' ? 'zh' : 'en'] ?? String(key) };
}

/** Requests stay on this App's origin; the Desktop proxy supplies backend identity. */
export function useAppApi() {
  return useMemo(() => {
    async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
      if (!path.startsWith('/api/') || path.includes('\\') || path.split('/').includes('..')) throw new Error('Invalid App API path');
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) throw new Error(typeof value === 'string' ? `${value.slice(0, 500) || 'Request failed'} (${response.status})` : value.detail || value.code || `Request failed (${response.status})`);
      if (typeof value === 'string') throw new Error('The App backend returned an unsupported response');
      return value as T;
    }
    return { get: <T,>(path: string) => request<T>(path, 'GET'), post: <T,>(path: string, body: unknown) => request<T>(path, 'POST', body) };
  }, []);
}

export function downloadFile(name: string, content: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
