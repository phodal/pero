import {AppBridge, PostMessageTransport, type McpUiResourceCsp, type McpUiHostContext} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';
import {closeMcpView} from './lifecycle.ts';

/** A resolved resource. The adapter owns its binding and enforces every operation. */
export type McpAppResource = Readonly<{
  html: string;
  csp?: McpUiResourceCsp;
  input: Record<string, unknown>;
  result: CallToolResult;
  sandbox: string;
  title: string;
}>;
export type McpAppHost = {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  readResource(uri: string): Promise<ReadResourceResult>;
  openLink(url: string): Promise<void>;
  revoke(): Promise<unknown>;
  onState(state: 'connecting' | 'ready' | 'closed'): void;
  onError(error: unknown): void;
};

/** Standard MCP Apps rendering; no Pero IPC, credentials, or execution ownership. */
export async function mountMcpApp(container: HTMLElement, resource: McpAppResource, host: McpAppHost,
  context: McpUiHostContext = {}) {
  const frame = document.createElement('iframe');
  frame.title = resource.title;
  frame.style.cssText = 'width:100%;height:480px;min-height:240px;border:0;display:block';
  frame.sandbox.add('allow-scripts', 'allow-same-origin');
  frame.referrerPolicy = 'no-referrer';
  container.append(frame);
  const bridge = new AppBridge(null, {name:'Pero MCP Apps Host', version:'1.0.0'},
    {serverTools:{}, serverResources:{}, openLinks:{}, sandbox:{csp:resource.csp, permissions:{}}},
    {hostContext:{displayMode:'inline', availableDisplayModes:['inline'], platform:'desktop', ...context}});
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    closed = true;
    clearTimeout(initializing);
    await closeMcpView({
      revoke:host.revoke,
      teardown:() => bridge.teardownResource({}, {timeout:3000}),
      dispose:async () => {
        try{await bridge.close();}
        finally{frame.remove();host.onState('closed');}
      },
    });
  })();
  const initializing = setTimeout(() => {
    if (!closed) host.onError(new Error('The MCP App did not initialize. Close it and open it again.'));
  }, 30_000);
  host.onState('connecting');
  bridge.oncalltool = params => host.callTool(params.name, params.arguments || {});
  bridge.onreadresource = params => host.readResource(params.uri);
  bridge.onopenlink = async ({url}) => { await host.openLink(url); return {}; };
  bridge.oninitialized = () => {
    clearTimeout(initializing);
    if (closed) return;
    void bridge.sendToolInput({arguments:resource.input}).then(() => {
      if(!closed)return bridge.sendToolResult(resource.result);
    }).then(() => { if (!closed) host.onState('ready'); }).catch(error=>{if(!closed)host.onError(error);});
  };
  bridge.onsizechange = ({height}) => { if(!closed && height!==undefined)frame.style.height=`${Math.min(960,Math.max(240,height))}px`; };
  bridge.onerror = error => { if (!closed) host.onError(error); };
  bridge.onsandboxready = () => {
    if(closed)return;
    void bridge.sendSandboxResourceReady({html:resource.html, csp:resource.csp,
      sandbox:'allow-scripts allow-same-origin allow-forms'}).catch(host.onError);
  };
  bridge.onrequestteardown = () => { void close().catch(host.onError); };
  try {
    await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
    frame.src = resource.sandbox;
  } catch (error) {
    await close().catch(host.onError);
    throw error;
  }
  return {close, setHostContext:(value:McpUiHostContext) => { if (!closed) bridge.setHostContext(value); }};
}
