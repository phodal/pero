import React, {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {Button, Feedback} from '@pero/app-sdk/ui';
import type {McpUiHostContext} from '@modelcontextprotocol/ext-apps/app-bridge';
import {mountMcpApp, type McpAppHost, type McpAppResource, type McpAppRuntime, type McpAppRuntimeOptions} from './runtime.ts';

export type McpAppSurfaceHandle = {close(): Promise<void>};
export type McpAppSurfaceProps = {
  resource: McpAppResource;
  host: Omit<McpAppHost, 'onState' | 'onError'> & Partial<Pick<McpAppHost, 'onState' | 'onError'>>;
  context?: McpUiHostContext;
  options?: McpAppRuntimeOptions;
  fallback?: React.ReactNode;
  onClose?(): void;
  /** Obtain a new admitted resource; this component never repeats the initial tool. */
  onRetry?(): void;
  labels?: {connecting?: string; close?: string; retry?: string};
  className?: string;
};

/** Product-owned resources, one shared result surface, and no connection or tool ownership. */
export const McpAppSurface = forwardRef<McpAppSurfaceHandle, McpAppSurfaceProps>(function McpAppSurface(
  {resource, host, context = {}, options, fallback, onClose, onRetry, labels, className}, ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'connecting' | 'ready' | 'closed'>('connecting');
  const [error, setError] = useState<string>();
  const [closing, setClosing] = useState(false);
  // A replaced resource retains its own Host while asynchronous teardown finishes.
  const owner = useMemo(() => ({host, context, options, live: false, mounting: undefined as Promise<McpAppRuntime | undefined> | undefined}), [resource]);
  owner.host = host;
  owner.context = context;
  owner.options = options;
  const report = (value: unknown) => {
    if (owner.live) setError(value instanceof Error ? value.message : String(value));
    owner.host.onError?.(value);
  };
  const close = async () => { await (await owner.mounting)?.close(); };
  useImperativeHandle(ref, () => ({close}), [owner]);

  useEffect(() => {
    let disposed = false;
    owner.live = true;
    setPhase('connecting');setError(undefined);setClosing(false);
    // StrictMode probes setup/cleanup synchronously. Allocate only after that
    // probe, so its cleanup cannot revoke the actual mount's admitted binding.
    const mounting = Promise.resolve().then(() => {
      if (disposed) return;
      return mountMcpApp(container.current!, resource, {
        callTool: (name, args) => owner.host.callTool(name, args),
        readResource: uri => owner.host.readResource(uri),
        openLink: url => owner.host.openLink(url),
        ...(owner.host.sendMessage ? {sendMessage: (text: string) => owner.host.sendMessage!(text)} : {}),
        revoke: () => owner.host.revoke(),
        onState: state => {
          if (!disposed) {setPhase(state);if (state === 'ready') setError(undefined);}
          owner.host.onState?.(state);
        },
        onError: report,
      }, owner.context, owner.options);
    });
    owner.mounting = mounting;
    void mounting.then(runtime => {
      if (disposed || !runtime) return;
      runtime.setHostContext(owner.context);
      if (owner.options?.size) runtime.setSizePolicy(owner.options.size);
    }).catch(report);
    return () => {
      disposed = true;
      owner.live = false;
      void mounting.then(runtime => runtime?.close()).catch(report);
    };
  }, [resource]);
  useEffect(() => {
    void owner.mounting?.then(runtime => {if (owner.live) runtime?.setHostContext(context);}).catch(report);
  }, [owner, context]);
  useEffect(() => {
    if (!options?.size) return;
    void owner.mounting?.then(runtime => {if (owner.live) runtime?.setSizePolicy(options.size!);}).catch(report);
  }, [owner, options?.size]);

  const showFallback = phase === 'closed' || (!!error && phase !== 'ready');
  const text = resource.result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  return <section className={className} aria-label={resource.title} aria-busy={phase === 'connecting' && !error}
    style={{display:'flex', flexDirection:'column', gap:'var(--pero-spacing-3)'}}>
    {phase === 'connecting' && !error && <Feedback>{labels?.connecting || 'Connecting view…'}</Feedback>}
    {error && <Feedback kind="error" variant="block">{error}
      {onRetry && <Button variant="link" onClick={onRetry}>{labels?.retry || 'Retry view'}</Button>}
    </Feedback>}
    {showFallback && (fallback ?? <pre style={{margin:0, whiteSpace:'pre-wrap', overflowWrap:'anywhere'}}>{text}</pre>)}
    {phase === 'closed' && !error && onRetry && <div><Button variant="link" onClick={onRetry}>{labels?.retry || 'Retry view'}</Button></div>}
    <div ref={container} hidden={phase === 'closed'}/>
    {onClose && <div style={{display:'flex', justifyContent:'flex-end'}}>
      <Button variant="ghost" busy={closing} onClick={() => {
        setClosing(true);
        void close().finally(onClose).catch(report).finally(() => {if (owner.live) setClosing(false);});
      }}>{labels?.close || 'Close view'}</Button>
    </div>}
  </section>;
});
