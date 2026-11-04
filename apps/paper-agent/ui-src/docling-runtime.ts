export type RuntimeComponent = 'software' | 'model';
export type RuntimeStatus = {
  state: 'idle' | 'installing' | 'ready' | 'failed' | 'cancelled' | 'revoked' | 'interrupted';
  software: 'missing' | 'ready'; model: 'missing' | 'ready'; component: RuntimeComponent | null;
  message: string; profile?: 'linux-x86_64-cp312' | 'macos-arm64-cp312' | null;
  installerSupported: boolean; softwareApproved: boolean; modelApproved: boolean;
};
type RuntimeIntent = { operation: 'status' | 'cancel' | 'revoke' } | { operation: 'request'; component: RuntimeComponent };

declare global {
  interface Window { __peroNativeDoclingRequest?: (body: string) => Promise<Response> }
}

/** Fixed Host intent, separate from the App's /api-only domain client. Approval stays in the shell. */
export async function requestDoclingRuntime(intent: RuntimeIntent): Promise<RuntimeStatus> {
  const body = JSON.stringify(intent.operation === 'request'
    ? { operation: intent.operation, component: intent.component } : { operation: intent.operation });
  const response = typeof window.__peroNativeDoclingRequest === 'function'
    ? await window.__peroNativeDoclingRequest(body)
    : await fetch('/host/docling-runtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = [value?.detail, value?.error].find(item => typeof item === 'string' && item);
    throw new Error(detail || `Docling runtime request failed (${response.status})`);
  }
  if (!value || !['idle', 'installing', 'ready', 'failed', 'cancelled', 'revoked', 'interrupted'].includes(value.state)
    || !['missing', 'ready'].includes(value.software) || !['missing', 'ready'].includes(value.model)
    || ![null, 'software', 'model'].includes(value.component) || typeof value.message !== 'string'
    || (value.profile != null && !['linux-x86_64-cp312', 'macos-arm64-cp312'].includes(value.profile))
    || typeof value.installerSupported !== 'boolean' || typeof value.softwareApproved !== 'boolean' || typeof value.modelApproved !== 'boolean') {
    throw new Error('Docling runtime returned an invalid status response');
  }
  return value;
}
