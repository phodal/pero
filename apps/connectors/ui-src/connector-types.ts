export type Requirement = { key: string; kind: 'text' | 'url' | 'path' | 'secretRef'; required?: boolean; helpId?: string };
export type Operation = { tool: string; effect: string; helpId?: string };
export type DirectoryEntry = {
  providerId: string; displayName: string; category: string; transport: string; brand?: string; iconId?: string;
  auth?: { mode: string; registration?: string; recommendedScopes?: string[] }; requires: Requirement[]; summary?: string; summaryEn?: string; prerequisiteCopy?: string; prerequisiteEn?: string; gotchaCopy?: string;
  sealed?: boolean; docsUrl?: string; endpoint?: string; oauthIssuer?: string; operations?: Operation[];
  stdioTemplate?: { args?: string[]; callTimeoutMs?: number; initializeTimeoutMs?: number };
  discovery?: { executables: string[]; prefix?: boolean; matlabRoot?: boolean; extensionFile?: boolean };
  installHint?: string; defaultTools?: string[]; catalogStage?: string; listed?: boolean; gotchaEn?: string;
};
export type Pinned = { path: string; sha256: string; executable: boolean };
export type Discovery = {
  state: 'idle' | 'running' | 'preparing' | 'done' | 'failed'; command: Pinned[]; matlabRoot: string[]; extensionFile: string[]; manual: boolean;
  installable: boolean; installSummary: string | null; installError: string | null; install: { state: 'running' | 'done' | 'failed' | 'cancelled'; log: string; exitCode: number | null } | null;
  /** Set by a successful managed install: the panel adds the connection once discovery is ready. */
  continueAfterInstall?: boolean;
  nativeCli?: Pinned[]; account?: { userName: string; appId: string; openId: string } | null; setupError?: string | null;
};
export type ToolEntry = { name: string; reason?: string };
export type Tools = { usable: string[]; blocked: ToolEntry[]; needsApproval: string[]; undeclared?: number };
export type ScopeGroup = { effect: string; tools: string[] };
export type Attempt = { attemptId: string; intent: string; state: string; expiresAtMs: number; pollIntervalMs: number };
export type ConnectionView = {
  connectionId: string; providerId: string; displayName: string; accountLabel: string; origin: string;
  state: string; reason: string; primary: string; secondary: string[]; lifecycle: string[];
  attempt: Attempt | null; revision: string; sealed: boolean; docsUrl: string; code: string; nextStep: string;
  enabled: boolean; badges: string[]; tools: Tools; scope?: { effects: ScopeGroup[]; missingScopes: string[] };
  transport: string; busy?: boolean;
};
export type RawEntry = { connectorId: string; definition: Record<string, any>; source: string };
export type Reply = { ok: boolean; code?: string; [key: string]: any };


export type ImportDraft = { connectorId: string; definition: Record<string, any>; notes: string[] };
