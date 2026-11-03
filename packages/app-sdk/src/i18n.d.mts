import type { AppLocale, AppMessages, AppMessageVars } from './host';
export function normalizeAppLocale(value?: string): AppLocale;
export function translateAppMessage(messages: AppMessages, locale: string, key: string, vars?: AppMessageVars): string;
export function createAppI18n(messages: AppMessages): { t(locale: string, key: string, vars?: AppMessageVars): string };
