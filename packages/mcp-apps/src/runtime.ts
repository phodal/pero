import {AppBridge, PostMessageTransport, type McpUiResourceCsp, type McpUiHostContext} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';
import {closeMcpView} from './lifecycle.ts';
import {defaultMcpAppSize, mcpAppHeight, mcpAppSizePolicy, type McpAppSizePolicy} from './size.ts';
export {defaultMcpAppSize, mcpAppHeight, mcpAppSizePolicy, type McpAppSizePolicy} from './size.ts';

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
  sendMessage?(text: string): Promise<void>;
  revoke(): Promise<unknown>;
  onState(state: 'connecting' | 'ready' | 'closed'): void;
  onError(error: unknown): void;
};
export type McpAppRuntimeOptions = Readonly<{
  hostInfo?: {name: string; version: string};
  size?: McpAppSizePolicy;
}>;
export type McpAppRuntime = {
  close(): Promise<void>;
  setHostContext(context: McpUiHostContext): void;
  setSizePolicy(policy: McpAppSizePolicy): void;
};

/** Standard MCP Apps rendering; no Pero IPC, credentials, or execution ownership. */
export async function mountMcpApp(container: HTMLElement, resource: McpAppResource, host: McpAppHost,
  context: McpUiHostContext = {}, options: McpAppRuntimeOptions = {}): Promise<McpAppRuntime> {
  let size = mcpAppSizePolicy(options.size ?? defaultMcpAppSize);
  let contentHeight = size.initialHeight;
  const frame = document.createElement('iframe');
  frame.title = resource.title;
  frame.style.cssText = `width:100%;height:${size.initialHeight}px;min-height:${size.minHeight}px;border:0;display:block`;
  frame.sandbox.add('allow-scripts', 'allow-same-origin');
  frame.referrerPolicy = 'no-referrer';
  container.append(frame);
  const bridge = new AppBridge(null, options.hostInfo ?? {name:'Pero MCP Apps Host', version:'1.0.0'},
    {serverTools:{}, serverResources:{}, openLinks:{}, ...(host.sendMessage?{message:{text:{}}}:{}), sandbox:{csp:resource.csp, permissions:{}}},
    {hostContext:{displayMode:'inline', availableDisplayModes:['inline'], platform:'desktop', ...context}});
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    closed = true;
    clearTimeout(initializing);
    await closeMcpView({
      revoke:() => host.revoke(),
      teardown:() => frame.isConnected ? bridge.teardownResource({}, {timeout:3000}) : Promise.resolve(),
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
  if(host.sendMessage)bridge.onmessage = async ({content}) => {
    if(closed||content.length===0||content.some(block=>block.type!=='text'))return {isError:true};
    try{await host.sendMessage!(content.map(block=>(block as {text:string}).text).join('\n'));return {};}
    catch(error){host.onError(error);return {isError:true};}
  };
  bridge.oninitialized = () => {
    clearTimeout(initializing);
    if (closed) return;
    void bridge.sendToolInput({arguments:resource.input}).then(() => {
      if(!closed)return bridge.sendToolResult(resource.result);
    }).then(() => { if (!closed) host.onState('ready'); }).catch(error=>{if(!closed)host.onError(error);});
  };
  bridge.onsizechange = ({height}) => {
    if(!closed && height!==undefined){contentHeight=height;frame.style.height=`${mcpAppHeight(size,height)}px`;}
  };
  bridge.onerror = error => { if (!closed) host.onError(error); };
  bridge.onsandboxready = () => {
    if(closed)return;
    void bridge.sendSandboxResourceReady({html:resource.html, csp:resource.csp,
      sandbox:'allow-scripts allow-same-origin allow-forms'}).catch(error => {if(!closed)host.onError(error);});
  };
  bridge.onrequestteardown = () => { void close().catch(error => host.onError(error)); };
  try {
    await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
    frame.src = resource.sandbox;
  } catch (error) {
    await close().catch(error => host.onError(error));
    throw error;
  }
  return {
    close,
    setHostContext:(value:McpUiHostContext) => { if (!closed) bridge.setHostContext(value); },
    setSizePolicy:(value:McpAppSizePolicy) => {
      if(closed)return;
      size=mcpAppSizePolicy(value);
      frame.style.minHeight=`${size.minHeight}px`;
      frame.style.height=`${mcpAppHeight(size,contentHeight)}px`;
    },
  };
}
