import type { ArtifactBrowserState, ArtifactTarget } from '../../protocol/artifact-browser';
import type { AppearanceSnapshot } from '../../packages/app-sdk/src/appearance';

export type { ArtifactTarget } from '../../protocol/artifact-browser';
export type ArtifactSurface = { visible: boolean; browser?: ArtifactBrowserState; left?: number; top?: number; width?: number; height?: number; clip?: number[]; dark?: boolean; locale?: string; appearance?: AppearanceSnapshot };

/** A distinct Scientific Viewer instance; it never navigates the user's file-library panel. */
export function mountArtifactPreview(compose: (target: ArtifactTarget, text: string, id: string) => void, select: (target: ArtifactTarget) => void) {
  const region = document.createElement('section');
  region.setAttribute('aria-label', 'Conversation artifact');
  region.hidden = true;
  region.style.cssText = 'position:fixed;z-index:3;overflow:hidden;background:var(--pero-surface)';
  const frame = document.createElement('iframe');
  frame.title = 'Scientific Viewer';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
  region.append(frame); document.body.append(region);
  let surface: ArtifactSurface = { visible: false }, key = '', ready = false, contextKey = '';
  const context = () => {
    if (!ready) return;
    const value = { active: surface.visible, dark: surface.dark, locale: surface.locale, appearance: surface.appearance, titlebar: true, artifactBrowser: surface.browser };
    const next = JSON.stringify(value);
    if (next === contextKey) return;
    contextKey = next;
    frame.contentWindow?.postMessage({ type: 'pero:app:context', context: value }, '*');
  };
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== 'pero-app://scientific-viewer') return;
    const message = event.data;
    if (message?.type === 'pero:app:ready') { ready = true; context(); }
    if (message?.type === 'pero:artifact:select' && surface.visible && message.target?.thread_id === surface.browser?.thread_id) select(message.target);
    if (['pero:app:chat', 'pero:artifact:compose'].includes(message?.type) && typeof message.id === 'string') {
      const text = message.type === 'pero:artifact:compose' ? message.text : message.options?.message ?? '';
      const target = message.type === 'pero:artifact:compose' ? message.target : surface.browser?.selected;
      const valid = surface.visible && !!target && target.thread_id === surface.browser?.thread_id && typeof text === 'string' && text.length <= 128_000;
      if (valid) compose(target, text, message.id);
      else reply(message.id, 'This artifact is no longer selected');
    }
  });
  const reply = (id: string, error?: string) => frame.contentWindow?.postMessage({ type: 'pero:app:chat-result', id, ok: !error, value: { threadId: surface.browser?.thread_id }, error: error || '' }, '*');
  const update = (value: ArtifactSurface) => {
    surface = value;
    region.hidden = !value.visible || !value.browser;
    if (region.hidden) { context(); return; }
    const browser = value.browser!, next = browser.thread_id;
    if (key !== next) {
      key = next; ready = false; contextKey = '';
      const query = new URLSearchParams({ thread_id: browser.thread_id });
      frame.src = `pero-app://scientific-viewer/dist/artifact.html?${query}`;
    }
    Object.assign(region.style, { left: `${value.left}px`, top: `${value.top}px`, width: `${value.width}px`, height: `${value.height}px`,
      clipPath: value.clip ? `inset(${value.clip.map(inset => `${inset}px`).join(' ')})` : '' });
    context();
  };
  return { update, reply };
}
