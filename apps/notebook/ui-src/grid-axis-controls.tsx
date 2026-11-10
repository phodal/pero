import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { Button } from '@pero/app-sdk/ui';
import { useAppI18n } from '@pero/app-sdk';
import { columnHeading, gridDimensionLimits, type WorksheetGrid } from '@pero/notebook/grid-presentation';
import { ColumnHeading } from './column-heading';

type Axis = 'row' | 'column';
type Gesture = { axis: Axis; index: number; pointer: number; start: number; original: number; value: number; kind: 'resize' | 'move'; changed: boolean };
const labels = {
  move: { en: 'Move {axis} {label}', zh: '移动{axis} {label}' },
  resize: { en: 'Resize {axis} {label}', zh: '调整{axis} {label}' },
  row: { en: 'row', zh: '行' }, column: { en: 'column', zh: '列' },
  instructions: { en: 'Drag a heading to reorder or its edge to resize. On a heading, use arrow keys to move; on an edge, use arrow keys to resize (Shift: 10 pixels). Home and End choose the limit. Escape cancels a drag.', zh: '拖动表头可排序，拖动边缘可调整尺寸。聚焦表头后用方向键移动，聚焦边缘后用方向键调整尺寸（Shift：10 像素）。Home 和 End 选择边界，Escape 取消拖动。' },
  previewMove: { en: 'Move {axis} {label} to position {value}', zh: '将{axis} {label} 移至第 {value} 个位置' },
  previewSize: { en: '{axis} {label}: {value} pixels', zh: '{axis} {label}：{value} 像素' },
};
const caption = (axis: Axis, index: number, names: Record<string, string>) => axis === 'row' ? String(index + 1) : columnHeading(index, names);

/** Transient pointer previews never write the document. Commit once on release,
 * cancel on Escape/capture loss/read-only, and delegate every domain edit. */
export function useGridAxisControls(root: RefObject<HTMLDivElement | null>, grid: WorksheetGrid, editable: boolean,
  resize: (axis: Axis, index: number, size: number) => boolean, move: (axis: Axis, index: number, to: number) => boolean,
  renameColumn?: (index: number) => void) {
  const { t } = useAppI18n(labels);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const capture = useRef<HTMLElement | null>(null);
  const retainedScroll = useRef({ left: 0, top: 0 });
  const [announcement, announce] = useState('');
  const dimensions = (axis: Axis, index: number) => (axis === 'row' ? grid.rowHeights : grid.columnWidths)[index] ?? gridDimensionLimits[axis].default;
  const count = (axis: Axis) => axis === 'row' ? grid.sheet.rows : grid.sheet.columns;
  const scroll = () => root.current?.querySelector<HTMLDivElement>('.notebook-grid-scroll');
  const rememberScroll = () => { const node = scroll(); if (node) retainedScroll.current = { left: node.scrollLeft, top: node.scrollTop }; };
  // Capture the live position before this render commits. Scroll events on the
  // grid do not reach the parent, and the commit below would otherwise restore 0.
  rememberScroll();
  useLayoutEffect(() => {
    const node = scroll();
    if (node) { node.scrollLeft = retainedScroll.current.left; node.scrollTop = retainedScroll.current.top; }
  }, [grid.sheet, grid.rowHeights, grid.columnWidths, grid.merges]);
  const cancel = () => {
    const current = gesture.current;
    gesture.current = null; setPreview(null);
    if (current && capture.current?.hasPointerCapture?.(current.pointer)) capture.current.releasePointerCapture(current.pointer);
    capture.current = null;
  };
  useEffect(() => {
    if (!editable) cancel();
  }, [editable]);
  useEffect(() => {
    if (!preview) return;
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [!!preview]);
  const label = (axis: Axis, index: number) => caption(axis, index, grid.columnNames ?? {});
  const heading = (axis: Axis, index: number) => axis === 'column'
    ? <ColumnHeading index={index} names={grid.columnNames ?? {}} />
    : String(index + 1);
  const describe = (current: Gesture) => t(current.kind === 'move' ? 'previewMove' : 'previewSize', {
    axis: t(current.axis), label: label(current.axis, current.index), value: current.value + (current.kind === 'move' ? 1 : 0),
  });
  const begin = (event: PointerEvent<HTMLElement>, axis: Axis, index: number, kind: Gesture['kind']) => {
    if (!editable || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation(); rememberScroll();
    event.currentTarget.focus({ preventScroll: true });
    const original = kind === 'resize' ? dimensions(axis, index) : index;
    const next: Gesture = { axis, index, kind, pointer: event.pointerId, start: axis === 'row' ? event.clientY : event.clientX, original, value: original, changed: false };
    gesture.current = next; capture.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId); setPreview(next);
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const point = current.axis === 'row' ? event.clientY : event.clientX;
    let value = current.original;
    if (current.kind === 'resize') {
      const limits = gridDimensionLimits[current.axis];
      value = Math.max(limits.min, Math.min(limits.max, Math.round(current.original + point - current.start)));
    } else if (Math.abs(point - current.start) >= 4 || current.changed) {
      const wrapper = scroll(), box = wrapper?.getBoundingClientRect();
      if (wrapper && box) {
        const edge = current.axis === 'row' ? [box.top, box.bottom] : [box.left, box.right];
        const offset = point < edge[0] + 28 ? -24 : point > edge[1] - 28 ? 24 : 0;
        if (current.axis === 'row') wrapper.scrollTop += offset; else wrapper.scrollLeft += offset;
        rememberScroll();
      }
      for (const header of root.current?.querySelectorAll<HTMLElement>(`th[data-grid-axis="${current.axis}"]`) ?? []) {
        const bounds = header.getBoundingClientRect();
        const start = current.axis === 'row' ? bounds.top : bounds.left, end = current.axis === 'row' ? bounds.bottom : bounds.right;
        if (point >= start && point <= end) { value = Number(header.dataset.gridIndex); break; }
      }
    }
    const next = { ...current, value, changed: current.changed || Math.abs(point - current.start) >= 4 };
    gesture.current = next; setPreview(next);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); rememberScroll(); cancel();
    if (!editable || !current.changed || current.value === current.original) return;
    const applied = current.kind === 'resize' ? resize(current.axis, current.index, current.value) : move(current.axis, current.index, current.value);
    if (applied) {
      announce(describe(current));
      if (current.kind === 'move') requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-move-axis="${current.axis}"][data-move-index="${current.value}"]`)?.focus({ preventScroll: true }));
    }
  };
  const key = (event: KeyboardEvent<HTMLElement>, axis: Axis, index: number, kind: Gesture['kind']) => {
    if (!editable || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const negative = axis === 'row' ? 'ArrowUp' : 'ArrowLeft', positive = axis === 'row' ? 'ArrowDown' : 'ArrowRight';
    if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); cancel(); rememberScroll();
    const limits = kind === 'resize' ? gridDimensionLimits[axis] : { min: 0, max: count(axis) - 1 };
    const original = kind === 'resize' ? dimensions(axis, index) : index;
    const value = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max :
      Math.max(limits.min, Math.min(limits.max, original + (event.key === negative ? -1 : 1) * (kind === 'resize' && event.shiftKey ? 10 : 1)));
    if (value === original) return;
    const applied = kind === 'resize' ? resize(axis, index, value) : move(axis, index, value);
    if (applied) {
      announce(describe({ axis, index, value, kind } as Gesture));
      if (kind === 'move') requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-move-axis="${axis}"][data-move-index="${value}"]`)?.focus({ preventScroll: true }));
    }
  };
  const size = (axis: Axis, index: number) => preview?.kind === 'resize' && preview.axis === axis && preview.index === index ? preview.value : dimensions(axis, index);
  const header = (axis: Axis, index: number, selected = false) => <th scope={axis === 'row' ? 'row' : 'col'} key={index} data-grid-axis={axis} data-grid-index={index}
    data-axis-selected={selected || undefined}
    data-move-target={preview?.kind === 'move' && preview.changed && preview.axis === axis && preview.value === index || undefined}>
    {editable ? <>
      <Button variant="ghost" className="notebook-axis-move" aria-label={t('move', { axis: t(axis), label: label(axis, index) })}
        title={t('instructions')} data-move-axis={axis} data-move-index={index}
        onPointerDown={event => begin(event, axis, index, 'move')} onPointerMove={drag} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onDoubleClick={event => { if (axis !== 'column' || !renameColumn) return; event.preventDefault(); event.stopPropagation(); renameColumn(index); }}
        onKeyDown={event => key(event, axis, index, 'move')}>{heading(axis, index)}</Button>
      <span role="separator" tabIndex={0} aria-orientation={axis === 'row' ? 'horizontal' : 'vertical'}
        aria-label={t('resize', { axis: t(axis), label: label(axis, index) })} aria-valuemin={gridDimensionLimits[axis].min}
        aria-valuemax={gridDimensionLimits[axis].max} aria-valuenow={size(axis, index)} aria-valuetext={`${size(axis, index)} px`}
        className="notebook-axis-resize" data-axis={axis} title={t('instructions')}
        onPointerDown={event => begin(event, axis, index, 'resize')} onPointerMove={drag} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onKeyDown={event => key(event, axis, index, 'resize')} />
    </> : heading(axis, index)}
  </th>;
  return { header, size, rememberScroll, instructions: t('instructions'), announcement: preview?.changed ? describe(preview) : announcement };
}
