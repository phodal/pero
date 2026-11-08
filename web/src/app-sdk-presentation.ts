export type AppPresentation =
  | { kind: 'page'; page: 'conversation' | 'document' | 'web' | 'projects' | 'agents' | 'tasks' | 'workers' | 'apps' | 'insights' | 'connections' }
  | { kind: 'app'; name: string; panel: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'research-source'; app: 'paper-agent' | 'control-lab'; href: string }
  | { kind: 'notify'; message: string; tone: 'info' | 'success' | 'error' }
  | { kind: 'badge'; count: number };

/** Admit App-owned presentation data once at the iframe boundary. */
export function appPresentation(operation: unknown, input: unknown): AppPresentation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid App presentation request');
  const value = input as Record<string, unknown>;
  if (operation === 'open-research-source' && typeof value.href === 'string' && Object.keys(value).length === 1) {
    const href = value.href;
    if (href !== href.trim()) throw new Error('Invalid research source location');
    if (/^pero-app-location:\/\/paper-agent\/main\/report\/[a-f0-9]{64}\/(?:citation\/[0-9]{1,9}|passage\/[a-f0-9]{64})$/.test(href))
      return { kind: 'research-source', app: 'paper-agent', href };
    if (/^pero-app-location:\/\/control-lab\/main\/experiment\/[a-f0-9]{32}\/trial\/[a-f0-9]{32}$/.test(href))
      return { kind: 'research-source', app: 'control-lab', href };
    throw new Error('Invalid research source location');
  }
  if (operation === 'open-session' && typeof value.sessionId === 'string' && value.sessionId.trim() && value.sessionId.length <= 128 && Object.keys(value).every(key => key === 'sessionId'))
    return { kind: 'session', sessionId: value.sessionId };
  if (operation === 'navigate' && typeof value.path === 'string') {
    const app = /^\/apps\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(value.path);
    if (app) return {kind:'app',name:app[1],panel:app[2] || 'main'};
    const pages = ['conversation','document','web','projects','agents','tasks','workers','apps','insights','connections'] as const;
    const page = pages.find(page => `/${page}` === value.path || value.path === '/' && page === 'projects');
    if (page) return {kind:'page',page};
    throw new Error('Choose a Pero page or /apps/<name>/<panel>');
  }
  if (operation === 'notify' && typeof value.message === 'string' && value.message.length > 0 && value.message.length <= 4000 &&
      (value.type === undefined || ['info','success','error'].includes(value.type as string)))
    return {kind:'notify',message:value.message,tone:(value.type ?? 'info') as 'info' | 'success' | 'error'};
  if (operation === 'badge' && Number.isSafeInteger(value.count) && (value.count as number) >= 0 && (value.count as number) <= 999999)
    return {kind:'badge',count:value.count as number};
  throw new Error('Invalid App presentation request');
}
