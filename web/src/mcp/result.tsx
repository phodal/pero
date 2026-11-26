import React from 'react';
import type {McpAppResource} from '@pero/mcp-apps';
import {McpAppSurface, type McpAppSurfaceHandle} from '@pero/mcp-apps/react';
import type {McpUiHostContext} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {McpAppBinding, McpPanelCommand} from '../../../packages/content-source/mcp-source.ts';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';

export type BoundResult = McpAppResource & {binding: McpAppBinding; canUpdateModelContext?: boolean};
const inlineSize = {initialHeight:320, minHeight:120, maxHeight:480};
const workbenchSize = {initialHeight:480, minHeight:240, maxHeight:960};

export function BoundResultView({view, surface, context, compact, managed, api, onClose, onRetry}: {
  view: BoundResult;
  surface: React.Ref<McpAppSurfaceHandle>;
  context: McpUiHostContext;
  compact: boolean;
  managed: boolean;
  api<T = unknown>(command: McpPanelCommand): Promise<T>;
  onClose(): void;
  onRetry?: () => void;
}) {
  const binding = view.binding.id;
  return <McpAppSurface ref={surface} resource={view} context={context}
    options={{size:compact ? inlineSize : workbenchSize}} onClose={onClose} onRetry={onRetry}
    host={{
      callTool:(name,args) => api<CallToolResult>({action:'tool',binding,name,arguments:args}),
      readResource:uri => api<ReadResourceResult>({action:'resource',binding,uri}),
      openLink:async url => { await api({action:'open_link',binding,url}); },
      ...(managed ? {sendMessage:async text => { await api({action:'message',binding,text}); }} : {}),
      ...(view.canUpdateModelContext ? {
        updateModelContext:async text => { await api({action:'update_model_context',binding,text}); },
      } : {}),
      revoke:() => api({action:'close',binding}),
    }}/>;
}
