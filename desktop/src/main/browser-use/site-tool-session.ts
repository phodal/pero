import { startBrowserReceipt } from './receipt.ts';
import type { BrowserRequest } from './request.ts';
import type { SiteTool, SiteToolAccess, SiteToolCommand, SiteToolsReply } from './site-tools.ts';

type SiteToolRequest = Extract<BrowserRequest, { action: 'listSiteTools' | 'callSiteTool' }>;
type SiteToolTab = { thread: string; grantId: string; tabId: string; origin: string; url: string };
const staleTool = 'The site tool registration changed. List the page tools again.';

export class BrowserSiteToolsMode implements SiteToolAccess {
  private session?: AbortController;

  constructor(readonly approve: SiteToolAccess['approve']) {}

  get enabled() { return !!this.session; }

  set(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.session?.abort();
    this.session = enabled ? new AbortController() : undefined;
  }

  signal() {
    if (!this.session) throw new Error('Enable Browser Site Tools in the Workbench first.');
    return this.session.signal;
  }
}

export class SiteToolSession {
  private readonly tools = new Map<string, SiteTool>();

  clear() { this.tools.clear(); }

  async call(request: SiteToolRequest, tab: SiteToolTab, access: SiteToolAccess, evidenceRoot: string,
    signal: AbortSignal, run: (command: SiteToolCommand, signal: AbortSignal) => Promise<SiteToolsReply>) {
    const active = AbortSignal.any([signal, access.signal()]);
    const execute = async (command: SiteToolCommand) => {
      active.throwIfAborted();
      const result = await run(command, active);
      active.throwIfAborted();
      if (result.kind === 'stale') throw new Error(staleTool);
      if (result.kind === 'unavailable') throw new Error('WebMCP is unavailable in this page.');
      return result;
    };
    const { thread, origin, tabId } = tab;
    active.throwIfAborted();
    if (request.action === 'listSiteTools') {
      const fromOrigins = [...new Set(request.fromOrigins ?? [])].filter(item => item !== origin);
      if (fromOrigins.length && !await access.approve(thread, origin, { kind: 'discover', fromOrigins }))
        throw new Error('Discovery of cross-origin site tools was declined.');
      this.clear();
      const listed = await execute({ kind: 'list', fromOrigins });
      if (listed.kind !== 'siteTools') throw new Error('Could not list the page tools.');
      for (const tool of listed.tools) this.tools.set(tool.id, tool);
      return { ...listed, tabId, origin };
    }
    const tool = this.tools.get(request.toolId);
    if (!tool) throw new Error(staleTool);
    if (!await access.approve(thread, origin, { kind: 'invoke', tool, input: request.input }))
      throw new Error('The site tool call was declined.');
    active.throwIfAborted();
    const { id, entry, record } = await startBrowserReceipt(evidenceRoot, { ...tab, action: request.action });
    await record('.intent', { ...entry, tool: tool.name, toolOrigin: tool.origin });
    let reply;
    try {
      reply = await execute({ kind: 'call', id: tool.id, input: request.input });
      if (reply.kind !== 'siteToolResult') throw new Error('Could not read the site tool result.');
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 600);
      await record('.result', { id, outcome: 'unknown', reason });
      return { receiptId: id, outcome: 'unknown', reason };
    }
    await record('.result', { id, outcome: 'dispatched' });
    return { ...reply, receiptId: id, outcome: 'dispatched' };
  }
}
