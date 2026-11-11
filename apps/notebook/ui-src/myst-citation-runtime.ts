import wasmAsset from 'refkit-js/refkit.wasm';
import { initializeMystCitations } from '@pero/notebook/myst-citations';

let pending: Promise<void> | undefined;
/** One package-owned asset from this App's origin. No user-controlled URLs. */
export function loadMystCitationRuntime(): Promise<void> {
  if (!pending) pending = (async () => {
    const response = await fetch(new URL(wasmAsset, import.meta.url), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Citation runtime could not load (${response.status}).`);
    await initializeMystCitations(await response.arrayBuffer());
  })().catch(error => { pending = undefined; throw error; });
  return pending;
}
