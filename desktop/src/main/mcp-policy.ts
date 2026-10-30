import type {McpUiResourceCsp} from '@modelcontextprotocol/ext-apps/app-bridge';
/** Admit CSP domain tokens once before they can become response-header directives. */
export function admitMcpCsp(csp:McpUiResourceCsp|undefined):McpUiResourceCsp|undefined {
  if(!csp)return undefined;
  for(const domains of Object.values(csp))for(const domain of domains||[]) {
    const url=new URL(domain);
    if(!['http:','https:','ws:','wss:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/[\s;]/.test(domain))throw new Error('MCP App declares an invalid CSP domain');
  }
  return csp;
}
export function mcpSandboxCsp(csp:McpUiResourceCsp|undefined):string {
  const resources=(csp?.resourceDomains||[]).join(' ');
  return ["default-src 'none'",`script-src 'self' 'unsafe-inline' 'unsafe-eval' ${resources}`,
    `style-src 'self' 'unsafe-inline' ${resources}`,`img-src 'self' data: blob: ${resources}`,
    `font-src 'self' data: ${resources}`,`media-src 'self' blob: ${resources}`,
    `connect-src ${(csp?.connectDomains||[]).join(' ')||"'none'"}`,
    `frame-src ${(csp?.frameDomains||[]).join(' ')||"'none'"}`,`base-uri 'self' ${(csp?.baseUriDomains||[]).join(' ')}`,
    "object-src 'none'", "form-action 'none'"].join('; ');
}
