import type { AppExampleAdapter, AppExampleDocument } from './host';
export type AppExampleEntry = { id: string; sha256?: string; default?: boolean };
export type AppExamplesSnapshot = Readonly<{ ready: boolean; busy: boolean; error: string; selected: AppExampleDocument | null }>;
export interface AppExamplesBridge {
  getSnapshot(): AppExamplesSnapshot;
  subscribe(listener: () => void): () => void;
  register(adapter: AppExampleAdapter): { update(adapter: AppExampleAdapter): void; dispose(): void };
  setActive(active: boolean): void;
  load(id: string, retry?: boolean, onlyEmpty?: boolean): Promise<void>;
  retry(): Promise<void> | undefined;
  dispose(): void;
}
export function createAppExamples(options?: { entries?: AppExampleEntry[]; read: (entry: AppExampleEntry, signal: AbortSignal) => Promise<AppExampleDocument>; requestId?: () => string }): AppExamplesBridge;
export function readAppExample(response: Response, entry: AppExampleEntry, cryptoProvider?: Crypto): Promise<AppExampleDocument>;
