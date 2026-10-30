import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import themes from '../../../web/src/theme.generated.json';
import './ui.css';
import { applyAppearance, readAppearance, type AppearanceSnapshot } from './appearance';
import type { AppChatAttachment,AppChatLaunch } from './app-chat';
export type { AppChatAttachment,AppChatLaunch } from './app-chat';
import { AppSurface, appSurface, installAppUseBridge, type AppObject } from './app-use';
export { AppSurface, appSurface } from './app-use';
export type { AppObject, AppObjectAction, AppObjectSnapshot } from './app-use';
export { appObjectProps } from './app-use';
export { useAppAgent } from './agent';
export { openDocument } from './document';
export type { AppDocumentInput } from './document';

export type AppContext = { locale: 'en' | 'zh-CN'; dark: boolean; active: boolean; appearance?: AppearanceSnapshot };
const Context = createContext<AppContext>({ locale: 'en', dark: false, active: true });

/** The parent owns context; the App frame never receives Desktop credentials. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<AppContext>({ locale: 'en', dark: false, active: true });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if(event.source!==window.parent)return;
      if(event.data?.type==='pero:app:data-changed'){window.dispatchEvent(new Event('pero:app:data-changed'));return;}
      if(event.data?.type!=='pero:app:context')return;
      const value = event.data.context;
      if (!value || !['en', 'zh-CN'].includes(value.locale) || typeof value.dark !== 'boolean' || typeof value.active !== 'boolean') return;
      const appearance = readAppearance(value.appearance);
      if (value.appearance !== undefined && !appearance) return;
      setContext({ locale: value.locale, dark: value.dark, active: value.active, appearance });
    };
    const stopAppUse = installAppUseBridge();
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:ready' }, '*');
    return () => { window.removeEventListener('message', receive); stopAppUse(); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = context.locale;
    document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
    for (const [key, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${key}`, value);
    document.documentElement.style.setProperty('--pero-text-secondary', (context.dark ? themes.dark : themes.light)['text-muted']);
    document.documentElement.style.setProperty('--pero-border-subtle', (context.dark ? themes.dark : themes.light).border);
    if (context.appearance) applyAppearance(context.appearance);
  }, [context.locale, context.dark, context.appearance]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export const useAppInfo = () => ({ active: useContext(Context).active });

/** Opens the host-owned chat or fills its draft. Neither action submits a prompt. */
export function useAppChat() {
  const launch=(options:AppChatLaunch={})=>new Promise<{threadId?:string;references?:string[]}>((resolve,reject)=>{
    const id=crypto.randomUUID();
    const receive=(event:MessageEvent)=>{
      if(event.source!==window.parent||event.data?.type!=='pero:app:chat-result'||event.data.id!==id)return;
      clearTimeout(timer);window.removeEventListener('message',receive);
      if(event.data.ok)resolve(event.data.value||{});else reject(new Error(event.data.error||'App chat request failed'));
    };
    const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('App chat request timed out'));},125000);
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'pero:app:chat',id,options},'*');
  });
  return {
    open:launch,
    compose:(text:string,options:Omit<AppChatLaunch,'message'>={})=>launch({...options,message:text}),
    objectReference:(objectId:string,selection?:AppChatAttachment['selection']):AppChatAttachment=>{
      const object=appSurface.observe(objectId).objects[0];
      return {type:'app-object',objectId,revision:object.revision,...(selection===undefined?{}:{selection})};
    }
  };
}
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

/** Exposes the App's current UI state and latest action closures to its parent. */
export function useAppObject(object: AppObject) {
  const handle = useRef<ReturnType<AppSurface['register']> | null>(null);
  const latest = useRef(object);
  latest.current = object;
  useEffect(() => {
    const registered = appSurface.register(latest.current);
    handle.current = registered;
    return () => { registered.dispose(); if (handle.current === registered) handle.current = null; };
  }, [object.id]);
  useEffect(() => { handle.current?.update(object); });
}

/** Refresh the App's existing domain projection after a declared Host write. */
export function useAppDataChanged(refresh:()=>void|Promise<void>){
  const latest=useRef(refresh);latest.current=refresh;
  useEffect(()=>{const receive=()=>{void latest.current();};window.addEventListener('pero:app:data-changed',receive);return()=>window.removeEventListener('pero:app:data-changed',receive);},[]);
}
