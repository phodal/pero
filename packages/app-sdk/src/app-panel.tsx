import { useEffect, useRef, useState } from 'react';
import { useAppContext } from './index';
import { useAppI18n } from './host';
import { Button, Feedback } from './ui';


const messages = {
  loading: { en: 'Opening App…', zh: '正在打开 App…' },
  waiting: { en: 'Scroll to show the App region. Notebook menus temporarily cover the live App.', zh: '滚动以显示 App 区域。打开笔记菜单时会暂时收起实时 App。' },
  unavailable: { en: 'This Host did not mount the App panel. Update the desktop runtime or open the App separately.', zh: 'Host 未挂载此 App 页面。请更新桌面运行时，或单独打开 App。' },
  retry: { en: 'Retry', zh: '重试' },
};

/** Host paints the real App surface here. The Notebook never receives its URL or permissions. */
export function EmbeddedAppPanel({ app, panel, title }: { app: string; panel: string; title: string }) {
  const { active } = useAppContext(), { t } = useAppI18n(messages);
  const element = useRef<HTMLDivElement>(null), activity = useRef(active);
  activity.current = active;
  const [state, setState] = useState<'loading' | 'mounted' | 'hidden' | 'error'>('loading');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!element.current) return;
    const id = crypto.randomUUID(); let previous = '', frame = 0;
    setState('loading'); setError('');
    const timeout = setTimeout(() => { setError(t('unavailable')); setState('error'); }, 30_000);
    const publish = () => {
      const box = element.current!.getBoundingClientRect();
      let clipped = false;
      for (let parent = element.current!.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if ((/^(auto|scroll|hidden|clip)$/.test(style.overflowX) && (box.left < bounds.left || box.right > bounds.right)) ||
            (/^(auto|scroll|hidden|clip)$/.test(style.overflowY) && (box.top < bounds.top || box.bottom > bounds.bottom))) { clipped = true; break; }
      }
      const popup = [...document.querySelectorAll<HTMLElement>('dialog[open], [role=menu], [role=listbox], .notebook-menu-panel')].some(node => node.getClientRects().length > 0);
      const rect = activity.current && !popup && !clipped && box.width >= 200 && box.height >= 180 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
        ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
      const next = JSON.stringify(rect);
      if (next !== previous) {
        previous = next;
        window.parent.postMessage({ type: 'pero:app:panel-slot', id, app, panel, rect }, '*');
      }
      frame = requestAnimationFrame(publish);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:panel-slot-result' || event.data.id !== id) return;
      clearTimeout(timeout);
      if (typeof event.data.error === 'string') { setError(event.data.error); setState('error'); }
      else setState(event.data.active ? 'mounted' : 'hidden');
    };
    window.addEventListener('message', receive); frame = requestAnimationFrame(publish);
    return () => {
      clearTimeout(timeout); cancelAnimationFrame(frame); window.removeEventListener('message', receive);
      window.parent.postMessage({ type: 'pero:app:panel-slot', id, app, panel, rect: null, release: true }, '*');
    };
  }, [app, panel, retry, t]);
  return <div ref={element} data-pero-app-panel={app} aria-label={title}
    style={{ height: 'min(30rem, 52vh)', minHeight: 240, position: 'relative', overflow: 'hidden' }}>
    {state !== 'mounted' && <Feedback kind={state === 'error' ? 'error' : 'info'} variant="block">
      {state === 'error' ? error : t(state === 'loading' ? 'loading' : 'waiting')}
      {state === 'error' && <Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button>}
    </Feedback>}
  </div>;
}
