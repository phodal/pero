export type SiteTool = { id: string; origin: string; name: string; description: string; inputSchema: unknown; frameUrl?: string };
export type SiteToolCommand = { kind: 'list'; fromOrigins: string[] } | { kind: 'call'; id: string; input: Record<string, unknown> };
export type SiteToolsReply =
  | { kind: 'unavailable' | 'stale' }
  | { kind: 'siteTools'; tools: SiteTool[]; truncated: boolean }
  | { kind: 'siteToolResult'; result: unknown };
export type SiteToolAccess = {
  signal(): AbortSignal;
  approve(thread: string, origin: string, review:
    { kind: 'discover'; fromOrigins: string[] } | { kind: 'invoke'; tool: SiteTool; input: Record<string, unknown> }): Promise<boolean>;
};

async function siteTools(origin: string, command: SiteToolCommand): Promise<SiteToolsReply> {
  if (location.origin !== origin || window.top !== window) return { kind: 'stale' };
  // This executes in the Workbench's isolated world. Keep the browser's
  // Tool object so a new registration with the same name cannot replace it.
  type Registration = { origin: string; window: Window; name: string; description: string; inputSchema?: unknown };
  const model = (document as Document & {
    modelContext?: {
      getTools(options?: { fromOrigins: string[] }): Promise<Registration[]>;
      executeTool(tool: Registration, input: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown>;
    };
  }).modelContext;
  if (typeof model?.getTools !== 'function' || typeof model?.executeTool !== 'function') return { kind: 'unavailable' };
  const world = globalThis as typeof globalThis & { peroSiteTools?: Map<string, Registration> };
  if (command.kind === 'list') {
    const approved = new Set([origin, ...command.fromOrigins]);
    const tools = (await model.getTools(command.fromOrigins.length ? { fromOrigins: [...approved] } : undefined))
      .filter(tool => approved.has(tool.origin));
    if (location.origin !== origin) return { kind: 'stale' };
    const registrations = world.peroSiteTools = new Map<string, Registration>();
    const utf8 = new TextEncoder();
    let remaining = 10000;
    const items: SiteTool[] = [];
    for (const tool of tools) {
      if (items.length === 24) break;
      const { name, description } = tool;
      if (name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) continue;
      let inputSchema = tool.inputSchema ?? { type: 'object' };
      if (typeof inputSchema === 'string') inputSchema = inputSchema ? JSON.parse(inputSchema) : { type: 'object' };
      let frameUrl: string | undefined;
      if (tool.origin === origin && tool.window !== window) {
        try {
          if (!tool.window || tool.window.location.origin !== origin) continue;
          frameUrl = (origin + tool.window.location.pathname).slice(0, 640);
        } catch {
          // Browsing context access changes if a frame navigates during discovery.
          continue;
        }
      }
      const size = utf8.encode(JSON.stringify(inputSchema) + description.slice(0, 600) + name + tool.origin + (frameUrl ?? '')).length;
      if (size > remaining) continue;
      remaining -= size;
      const id = crypto.randomUUID();
      registrations.set(id, tool);
      items.push({ id, origin: tool.origin, name, description: description.slice(0, 600), inputSchema, ...(frameUrl && { frameUrl }) });
    }
    return { kind: 'siteTools', tools: items, truncated: tools.length > items.length };
  }
  const tool = world.peroSiteTools?.get(command.id);
  if (!tool) return { kind: 'stale' };
  const result = await model.executeTool(tool, command.input, { signal: AbortSignal.timeout(7000) });
  if (new TextEncoder().encode(typeof result === 'string' ? result : JSON.stringify(result)).length > 16384)
    throw new Error('The site tool returned more than 16 KiB. Inspect the page before retrying.');
  return { kind: 'siteToolResult', result: typeof result === 'string' ? JSON.parse(result) : result };
}

export function siteToolsScript(origin: string, command: SiteToolCommand) {
  return `(${siteTools.toString()})(${JSON.stringify(origin)}, JSON.parse(${JSON.stringify(JSON.stringify(command))}))`;
}
