import type { AppApi, PointAppHost, HostCallFn, AppSurface, AppExamples } from './host';
export class AppApiError extends Error { constructor(status: number, body: string); status: number; body: string }
export function normalizeAllowedApiPaths(paths: string[]): readonly string[];
export function scopedApiPath(path: string, paths: readonly string[], appName?: string): string;
export function createScopedApi(options?: { appName?: string; allowedApiPaths?: string[]; fetch?: typeof globalThis.fetch; hostHeaders?: HeadersInit }): AppApi;
export function eventPermissionMatches(event: string, permission: string): boolean;
export function checkEventPermission(event: string, allowedEvents: readonly string[]): { allowed: true; permission: string } | { allowed: false; reason: string };
export function createAppEventHub(): Readonly<{ subscribe: PointAppHost['subscribe']; emit(event: string, value: unknown): void; clear(): void }>;
export function createAppHost(options?: { name: string; version?: string; locale?: string; allowedApiPaths?: string[]; allowedEvents?: string[]; active?: boolean; fetch?: typeof globalThis.fetch; hostHeaders?: HeadersInit; subscribe?: PointAppHost['subscribe']; navigate?: PointAppHost['navigate']; notify?: PointAppHost['notify']; setBadge?: PointAppHost['setBadge']; launchChat?: PointAppHost['launchChat']; surface?: AppSurface | null; examples?: AppExamples | null; allowedHostCapabilities?: string[]; hostCall?: HostCallFn }): Readonly<PointAppHost>;
export type OptionMarker = { start: number; end: number; labels: string; multi: boolean };
export function findOptionMarkers(content: string): OptionMarker[];
export function stripOptionMarkers(content: string): string;
export function parseOptions(content: string): { text: string; options: string[]; multi: boolean; isPlan: boolean };
export function extractSteeringAcks(content: string): { cleaned: string; acks: string[] };
export function stripKeepVisibleMarker(content: string): string;
export function hasKeepVisibleMarker(content: string): boolean;
