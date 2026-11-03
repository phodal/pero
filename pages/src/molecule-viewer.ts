import { mountMoleculeExplorer } from '../../packages/molecule-viewer/explorer';
import './molecule-viewer.css';

const explorer = mountMoleculeExplorer(document.getElementById('molecule-root')!, { locale: 'zh-CN', dark: false });
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'pero:app:context') return;
  const value = event.data.context;
  if (!value || !['en', 'zh-CN'].includes(value.locale) || typeof value.dark !== 'boolean') return;
  document.documentElement.lang = value.locale;
  document.documentElement.style.colorScheme = value.dark ? 'dark' : 'light';
  explorer.updateContext({ locale: value.locale, dark: value.dark });
});
window.parent.postMessage({ type: 'pero:app:ready' }, location.origin);
