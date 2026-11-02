import { AppSurface } from './app-use';
export { AppUseError as AppSurfaceError } from './app-use';
export const APP_OBJECT_LIMITS: Readonly<{ objects: 100; actions: 32; stateBytes: 32768; paramsBytes: 65536; resultBytes: 32768 }>;
export function createAppSurface(options: { appName: string; tabId?: string }): AppSurface;
export function validateParameters(schema: Record<string, unknown>, params: unknown): void;
export function appObjectProps(id: string): { 'data-app-object': string };
