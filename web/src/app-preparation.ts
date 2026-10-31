import { translate } from '../../locales';
import type { HostEvent } from './bootstrap';

type Preparation = { name: string; phase: 'checking' | 'creating' | 'installing' | 'ready' | 'failed'; message: string };

/** Installation has its own status, independent of the App iframe readiness timer. */
export function mountAppPreparation(command: (value: object) => Promise<void>, chinese: () => boolean) {
  const records = new Map<string, { value: Preparation; log: string[] }>();
  const region = document.createElement('section');
  region.className = 'app-preparation'; region.hidden = true;
  region.setAttribute('aria-label', 'App environment');
  document.body.append(region);
  let selected = '';
  const render = () => {
    const record = records.get(selected);
    if (!record) return;
    const { value, log } = record;
    const t = (key: Parameters<typeof translate>[1]) => translate(chinese() ? 'zh-CN' : 'en', key);
    const busy = value.phase !== 'ready' && value.phase !== 'failed';
    const expanded = region.querySelector('details')?.open ?? false;
    region.replaceChildren();
    const header = document.createElement('div'); header.className = 'app-preparation-header';
    const title = document.createElement('strong'); title.textContent = `${value.name} ${t('apps.env_title')}`;
    const close = document.createElement('button'); close.textContent = t('apps.env_hide'); close.onclick = () => { region.hidden = true; };
    header.append(title, close);
    const status = document.createElement('p'); status.setAttribute('role', value.phase === 'failed' ? 'alert' : 'status');
    status.textContent = t(`apps.env_${value.phase}`);
    region.append(header, status);
    if (busy) {
      const progress = document.createElement('progress'); progress.setAttribute('aria-label', status.textContent); region.append(progress);
    }
    if (value.phase !== 'ready') { const message = document.createElement('p'); message.textContent = value.message; region.append(message); }
    const details = document.createElement('details'); details.open = expanded || value.phase === 'failed';
    const summary = document.createElement('summary'); summary.textContent = t('apps.env_log');
    const output = document.createElement('pre'); output.textContent = log.join('\n');
    details.append(summary, output); region.append(details);
    if (value.phase === 'failed') {
      const retry = document.createElement('button'); retry.textContent = t('apps.env_retry');
      retry.onclick = () => { retry.disabled = true; void command({ action: 'apps_enable', name: value.name }); };
      region.append(retry);
    }
  };
  return {
    event(event: HostEvent) {
      if (event.kind !== 'apps_preparation') return;
      const value = event.data as Preparation;
      const previous = records.get(value.name);
      const fresh = value.phase === 'checking';
      const log = fresh ? [] : previous?.log ?? [];
      log.push(value.message); if (log.length > 100) log.shift();
      records.set(value.name, { value, log }); selected = value.name;
      // A cached check does not flash a window on every App open. Show only
      // work that takes time, or a failure requiring the user's attention.
      if (value.phase === 'creating' || value.phase === 'installing' && previous?.value.phase !== 'installing' || value.phase === 'failed') region.hidden = false;
      render();
    },
  };
}
