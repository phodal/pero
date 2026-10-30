import { installContentAnalysis } from './content-analysis';
import init, { run, receive_document, receive_chart, set_context, set_icon_theme, snapshot } from './reader-wasm/pero_reader_web';
import { AppDocuments, type AppDocumentInput } from '../../packages/content-source/app-document';
import { applyAppearance, readAppearance } from '../../packages/app-sdk/src/appearance';
import type { DocumentHeader } from '../../protocol/generated/host';
import { normalizeLocale, translate } from '../../locales';
import themes from './theme.generated.json';
import './chat.css';
import type { ReaderContext } from '../../packages/app-sdk/src/reader-surface';

type Source = { header: DocumentHeader; text: string };
type Reading = { source?: Source; document?: AppDocumentInput; chart?: unknown; context: ReaderContext };
const nonce = new URL(location.href).searchParams.get('nonce');
const parentOrigin = new URL(location.href).searchParams.get('parent');
if (!nonce || !parentOrigin || window.parent === window) throw new Error('A reader must be mounted by its owning App.');
const standalone = new AppDocuments('standalone', 'content');
let initialized = false, reading: Reading | undefined;
let initialReading: (value: Reading) => void;
const connected = new Promise<Reading>(resolve => { initialReading = resolve; });
const post = (type: string, extra: object = {}) => window.parent.postMessage({ type, nonce, ...extra }, parentOrigin);
const apply = () => {
  if (!reading) return;
  const { context } = reading;
  document.documentElement.lang = normalizeLocale(context.locale);
  document.documentElement.style.colorScheme = context.dark ? 'dark' : 'light';
  for (const [key, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${key}`, value);
  if (!initialized) return;
  const appearance = readAppearance(context.appearance);
  if (appearance) applyAppearance(appearance);
  set_context(context.dark, context.locale, appearance ? JSON.stringify(appearance) : '');
  if(context.iconTheme!==undefined)set_icon_theme(JSON.stringify(context.iconTheme));
  if (reading.chart !== undefined) { receive_chart(JSON.stringify(reading.chart)); return; }
  // Workbench sources are already admitted by the owning AppDocuments. Bare Apps
  // enter that same boundary here; arbitrary origins never reach the reader.
  const source = reading.document ? standalone.admit(reading.document) : reading.source;
  if (!source || source.header.source.origin.kind !== 'app') throw new Error('Invalid App source');
  receive_document(JSON.stringify(source));
};
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.nonce !== nonce) return;
  try {
  if (event.data.type === 'pero:reader:document' || event.data.type === 'pero:reader:chart') {
    const value = event.data.reading as Reading;
    if (!value?.context || typeof value.context.locale !== 'string' || typeof value.context.dark !== 'boolean') return;
    if (value.context.appearance !== undefined && !readAppearance(value.context.appearance)) return;
    reading = value; initialReading(value);
    apply();
  } else if (event.data.type === 'pero:reader:context' && reading) {
    const context = event.data.context as ReaderContext;
    const appearance = readAppearance(context?.appearance);
    if (typeof context?.locale !== 'string' || typeof context.dark !== 'boolean' || context.appearance !== undefined && !appearance) return;
    reading.context = { ...reading.context, ...context, appearance };
    if (initialized) {
      if(appearance)applyAppearance(appearance); set_context(context.dark,context.locale,appearance?JSON.stringify(appearance):'');
      if(context.iconTheme!==undefined)set_icon_theme(JSON.stringify(context.iconTheme));
    }
  }
  } catch (error) { post('pero:reader:error', { error: String(error) }); }
});
window.peroReaderOpenLink = value => {
  try { const url = new URL(value); if (url.protocol === 'https:' || url.protocol === 'http:') post('pero:reader:link', { url: url.href }); } catch { /* malformed source link */ }
};
post('pero:reader:connect');
try {
  reading = await connected;
  apply(); await init(); installContentAnalysis();
  run(JSON.stringify(themes), reading.context.dark, normalizeLocale(reading.context.locale));
  const deadline = performance.now() + 30000;
  while (!JSON.parse(snapshot()).ready) {
    if (performance.now() > deadline) throw new Error(translate(reading.context.locale, 'error.loading'));
    await new Promise(requestAnimationFrame);
  }
  initialized = true; apply();
  window.peroReaderDiagnostics = { snapshot };
  document.getElementById('loading')?.remove(); post('pero:reader:ready');
} catch (error) {
  const loading = document.getElementById('loading')!;
  loading.textContent = `${translate(reading?.context.locale || 'en', 'error.loading')} ${String(error)}`;
  loading.setAttribute('role', 'alert'); post('pero:reader:error', { error: String(error) });
}
declare global {
  interface Window { peroReaderOpenLink(value: string): void; peroReaderDiagnostics: { snapshot: typeof snapshot } }
}
