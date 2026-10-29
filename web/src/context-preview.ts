import type { ContextReference } from '../../protocol/generated/host';

type Region = { x: number; y: number; width: number; height: number };

/** Annotations describe immutable pixels; the evidence image and its receipt stay intact. */
export function previewContext(reference: ContextReference, annotate?: (context: ContextReference) => void) {
  const zh = document.documentElement.lang.startsWith('zh');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', reference.label);
  dialog.style.cssText =
    'width:min(900px,90vw);max-height:85vh;overflow:auto;padding:16px;color:var(--pero-text);background:var(--pero-surface);border:1px solid var(--pero-border);border-radius:6px';
  const title = document.createElement('strong');
  title.textContent = reference.label;
  const button = (label: string, action: () => void) => {
    const el = document.createElement('button');
    el.textContent = label;
    el.type = 'button';
    el.style.cssText =
      'font:inherit;padding:6px 10px;color:inherit;background:var(--pero-surface-muted);border:1px solid var(--pero-border);border-radius:3px';
    el.onclick = action;
    return el;
  };
  const close = button(zh ? '关闭' : 'Close', () => dialog.close());
  close.autofocus = true;
  close.style.float = 'right';
  dialog.append(title, close);
  if (reference.content.type === 'image') {
    const stage = document.createElement('div');
    stage.style.cssText = 'position:relative;width:fit-content;max-width:100%;margin:12px auto';
    const image = document.createElement('img');
    image.alt = reference.label;
    image.draggable = false;
    image.src = `data:${reference.content.mime_type};base64,${reference.content.data}`;
    image.style.cssText = 'display:block;max-width:100%;max-height:52vh;object-fit:contain';
    stage.append(image);
    dialog.append(stage);
    if (annotate) {
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.setAttribute('viewBox', '0 0 1 1');
      overlay.setAttribute('preserveAspectRatio', 'none');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none';
      stage.append(overlay);
      const regions: Region[] = [];
      let start: { x: number; y: number } | undefined;
      const note = document.createElement('textarea');
      note.maxLength = 4000;
      note.rows = 3;
      note.setAttribute('aria-label', zh ? '标注说明' : 'Annotation note');
      note.placeholder = zh ? '拖动框选区域，或直接填写说明' : 'Drag to mark a region, or enter a note';
      note.style.cssText =
        'display:block;box-sizing:border-box;width:100%;margin:10px 0;padding:8px;font:inherit;color:inherit;background:var(--pero-surface);border:1px solid var(--pero-border)';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const count = document.createElement('span');
      count.setAttribute('role', 'status');
      const whole = button(zh ? '标注整张图片' : 'Mark whole image', () => {
        if (regions.length < 20) regions.push({ x: 0, y: 0, width: 1, height: 1 });
        render();
      });
      const undo = button(zh ? '撤销区域' : 'Undo region', () => {
        regions.pop();
        render();
      });
      const add = button(zh ? '添加标注到草稿' : 'Add annotations to draft', () => {
        const id = crypto.randomUUID();
        annotate({
          id: `app-markup-${id}`,
          kind: 'app_object',
          label: zh ? '截图标注' : 'Screenshot annotations',
          source: reference.source,
          content: {
            type: 'text',
            text: JSON.stringify({
              schema: 'pero.app-annotations.v1',
              imageReference: reference.id,
              evidence: reference.source,
              width: image.naturalWidth,
              height: image.naturalHeight,
              regions: regions.map((region) => ({
                x: Math.round(region.x * image.naturalWidth),
                y: Math.round(region.y * image.naturalHeight),
                width: Math.round(region.width * image.naturalWidth),
                height: Math.round(region.height * image.naturalHeight),
              })),
              note: note.value.trim(),
            }),
          },
        });
        dialog.close();
      });
      function render() {
        overlay.replaceChildren();
        for (const region of regions) {
          const box = document.createElementNS(overlay.namespaceURI, 'rect');
          for (const [key, value] of Object.entries(region)) box.setAttribute(key, String(value));
          box.setAttribute('fill', 'rgba(127,127,127,.12)');
          box.setAttribute('stroke', 'currentColor');
          box.setAttribute('stroke-width', '.004');
          overlay.append(box);
        }
        undo.disabled = !regions.length;
        whole.disabled = regions.length >= 20;
        add.disabled = !image.complete || !image.naturalWidth || (!regions.length && !note.value.trim());
        count.textContent = `${regions.length}/20`;
      }
      const point = (event: PointerEvent) => {
        const rect = overlay.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1, (event.clientX - rect.x) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.y) / rect.height)),
        };
      };
      overlay.addEventListener('pointerdown', (event) => {
        if (regions.length >= 20 || event.button !== 0) return;
        start = point(event);
        overlay.setPointerCapture(event.pointerId);
      });
      overlay.addEventListener('pointerup', (event) => {
        if (!start) return;
        const end = point(event),
          region = {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(start.x - end.x),
            height: Math.abs(start.y - end.y),
          };
        start = undefined;
        if (region.width > 0.002 && region.height > 0.002) regions.push(region);
        render();
      });
      overlay.addEventListener('pointercancel', () => {
        start = undefined;
      });
      note.oninput = render;
      image.onload = render;
      actions.append(whole, undo, count, add);
      dialog.append(note, actions);
      render();
    }
  } else {
    const text = document.createElement('pre');
    text.textContent = reference.content.text;
    text.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;max-height:70vh;overflow:auto;margin-top:12px';
    dialog.append(text);
  }
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
