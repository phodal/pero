// One semantic registry and one parameter interpreter serve both SDK contracts.
import { AppSurface, AppParameterSchema, AppUseError, appObjectProps } from './app-use.ts';
export { AppUseError as AppSurfaceError } from './app-use.ts';
export const APP_OBJECT_LIMITS = Object.freeze({ objects: 100, actions: 32, stateBytes: 32768, paramsBytes: 65536, resultBytes: 32768 });
export function createAppSurface({ appName, tabId } = {}) {
  if (typeof appName !== 'string' || !appName) throw new TypeError('appName is required');
  return new AppSurface(appName, tabId ?? null);
}
export function validateParameters(schema, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new AppUseError('APP_PARAMS_INVALID', 'Object parameters required');
  if (new TextEncoder().encode(JSON.stringify(params)).length > APP_OBJECT_LIMITS.paramsBytes) throw new AppUseError('APP_PARAMS_INVALID', 'Parameters exceed 64 KiB');
  AppParameterSchema.parse({ type: 'object', ...schema }).validate(params);
}
/** Migrated DOM carriers resolve through Pero's existing App Use bridge. */
export const pointObjectProps = appObjectProps;
