import React, { useEffect, useRef, useState } from 'react';

/** Publish an actual App region; the parent retains conversation ownership. */
export function mountAppConversation(slot: HTMLElement, { sessionId, onMounted = () => {} }: { sessionId?: string; onMounted?: (mounted: boolean) => void } = {}) {
  const active = true;
    const id = crypto.randomUUID();
    let previous = '';
    let frame = 0;
    const publish = () => {
      frame = 0;
      const box = slot.getBoundingClientRect();
      let clipped = false;
      for (let parent = slot.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if ((clipX && (box.left < bounds.left || box.right > bounds.right)) ||
            (clipY && (box.top < bounds.top || box.bottom > bounds.bottom))) { clipped = true; break; }
      }
      const rect = active && !clipped && getComputedStyle(slot).visibility === 'visible' && document.visibilityState !== 'hidden' && box.width > 0 && box.height > 0 &&
        box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
        ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
      const value = JSON.stringify(rect);
      if (value !== previous) {
        previous = value;
        if (!rect) onMounted(false);
        window.parent.postMessage({ type: 'pero:app:chat-slot', id, rect, ...(sessionId ? {sessionId} : {}) }, '*');
      }
      // Layout shifts can move a slot without resizing it or scrolling.
      if (active) frame = requestAnimationFrame(publish);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(publish); };
    const receive = (event: MessageEvent) => {
      if (event.source === window.parent && event.data?.type === 'pero:app:chat-slot-result' && event.data.id === id && typeof event.data.active === 'boolean') onMounted(previous !== 'null' && event.data.active);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(slot);
    window.addEventListener('message', receive);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('message', receive);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      document.removeEventListener('visibilitychange', schedule);
      window.parent.postMessage({ type: 'pero:app:chat-slot', id, rect: null }, '*');
    };

}

export function AppConversation({ active = true, className, fallback }: { active?: boolean; className?: string; fallback?: React.ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!active || !element.current) { setMounted(false); return; }
    return mountAppConversation(element.current, { onMounted: setMounted });
  }, [active]);
  return <div ref={element} className={className} data-pero-chat-slot="" data-mounted={mounted || undefined}>{!mounted && fallback}</div>;
}
