import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import themes from '../../../web/src/theme.generated.json';
import './ui.css';
import { applyAppearance, readAppearance, type AppearanceSnapshot } from './appearance';
import type { AppChatAttachment,AppChatLaunch } from './app-chat';
export type { AppChatAttachment,AppChatLaunch } from './app-chat';
import { AppSurface, appSurface, installAppUseBridge, } from './app-use';
export { AppSurface, appSurface } from './app-use';
export type { AppObject, AppObjectAction, AppObjectSnapshot } from './app-use';
export { appObjectProps } from './app-use';
export { useAppAgent } from './agent';
export * from './host';
import { mountAppConversation } from './chat-slot';
import { AppApiProvider } from './host';
import { subscribeAppEvent, navigateApp, notifyApp, setAppBadge, launchAppChat, callAppHost } from './iframe-host';
export { openAppSession, requestAppShell } from './iframe-host';
export { openPaperApp } from './navigation';
export { openDocument } from './document';
export type { AppDocumentInput } from './document';
export {ContentIconRegistry,contentIcons,contentIcon} from '../../icons/content';
export type {ContentIconInput,ContentIconKind,ContentIconAssociation,BundledIconName} from '../../icons/content';
import {setActiveIconTheme,type IconThemePackage} from '../../icons/theme';
export {getActiveIconTheme} from '../../icons/theme';
export type {IconThemePackage} from '../../icons/theme';

export type AppContext = { locale: 'en' | 'zh-CN'; dark: boolean; active: boolean; appearance?: AppearanceSnapshot; iconTheme?:IconThemePackage|null; name?: string; version?: string; slots?: string[]; permissions?: { api: string[]; events: string[]; host: string[] } };
const Context = createContext<AppContext>({ locale: 'en', dark: false, active: true });

/** The parent owns context; the App frame never receives Desktop credentials. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<AppContext>({ locale: 'en', dark: false, active: true });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if(event.source!==window.parent)return;
      if(event.data?.type==='pero:app:icon-theme'){
        const iconTheme=event.data.theme??null;setActiveIconTheme(iconTheme);setContext(previous=>({...previous,iconTheme}));return;
      }
      if(event.data?.type==='pero:app:data-changed'){window.dispatchEvent(new Event('pero:app:data-changed'));return;}
      if(event.data?.type!=='pero:app:context')return;
      const value = event.data.context;
      if (!value || !['en', 'zh-CN'].includes(value.locale) || typeof value.dark !== 'boolean' || typeof value.active !== 'boolean') return;
      const appearance = readAppearance(value.appearance);
      if (value.appearance !== undefined && !appearance) return;
      setContext(previous => {
        if (
          previous.locale === value.locale
          && previous.dark === value.dark
          && previous.active === value.active
          && JSON.stringify(previous.appearance) === JSON.stringify(appearance)
        ) return previous;
        return { ...previous, locale: value.locale, dark: value.dark, active: value.active, appearance, iconTheme: previous.iconTheme };
      });
    };
    const stopAppUse = installAppUseBridge();
    void fetch('/host/sdk').then(response => response.ok ? response.json() : null).then(info => { if (info) setContext(previous => ({ ...previous, ...info })); }).catch(() => {});
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:ready' }, '*');
    return () => { window.removeEventListener('message', receive); stopAppUse(); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = context.locale;
    document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = context.dark ? 'pero-dark' : 'pero-light';
    for (const [key, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${key}`, value);
    document.documentElement.style.setProperty('--pero-text-secondary', (context.dark ? themes.dark : themes.light)['text-muted']);
    document.documentElement.style.setProperty('--pero-border-subtle', (context.dark ? themes.dark : themes.light).border);
    if (context.appearance) applyAppearance(context.appearance);
    window.dispatchEvent(new CustomEvent('pero:app:context-changed',{detail:context}));
  }, [context.locale, context.dark, context.active,context.appearance,context.iconTheme]);
  return <Context.Provider value={context}><AppApiProvider appName={context.name || location.hostname || 'app'} appVersion={context.version}
    locale={context.locale} active={context.active} allowedApiPaths={context.permissions?.api ?? ['/api']}
    allowedEvents={context.permissions?.events ?? []} allowedHostCapabilities={context.permissions?.host ?? []}
    subscribeFn={subscribeAppEvent} navigateFn={navigateApp} notifyFn={notifyApp} setBadgeFn={setAppBadge}
    launchChatFn={async options => (await launchAppChat(options)).threadId} mountConversationFn={context.slots?.includes('conversation') ? mountAppConversation : undefined} mountSessionConversationFn={context.slots?.includes('session-conversation') ? mountAppConversation : undefined} hostCallFn={callAppHost} surface={appSurface}>
    {children}</AppApiProvider></Context.Provider>;
}

export const useAppContext = () => useContext(Context);

/** Opens the host-owned chat or fills its draft. Neither action submits a prompt. */
export function useAppChat() {
  const launch = launchAppChat;
  return {
    open:launch,
    compose:(text:string,options:Omit<AppChatLaunch,'message'>={})=>launch({...options,message:text}),
    objectReference:(objectId:string,selection?:AppChatAttachment['selection']):AppChatAttachment=>{
      const object=appSurface.observe(objectId).objects[0];
      return {type:'app-object',objectId,revision:object.revision,...(selection===undefined?{}:{selection})};
    }
  };
}
/** Refresh the App's existing domain projection after a declared Host write. */
export function useAppDataChanged(refresh:()=>void|Promise<void>){
  const latest=useRef(refresh);latest.current=refresh;
  useEffect(()=>{const receive=()=>{void latest.current();};window.addEventListener('pero:app:data-changed',receive);return()=>window.removeEventListener('pero:app:data-changed',receive);},[]);
}
