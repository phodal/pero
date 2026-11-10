import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, Input, Select } from '@pero/app-sdk/ui';
import { attachmentLimits, rasterEditPlan, rasterLimits, type RasterEdit } from '@pero/notebook/attachment';

export { rasterEditPlan, rasterLimits, type RasterEdit } from '@pero/notebook/attachment';

/** Decode local verified bytes, render a bounded PNG, then let attachment ingestion calculate its new digest. */
export async function renderRasterEdit(blob: Blob, edit: RasterEdit): Promise<Blob> {
  const image = await createImageBitmap(blob);
  try {
    const plan = rasterEditPlan(image.width, image.height, edit);
    // Isolate the crop at native resolution before filtering. Resampling a source
    // rectangle directly can blend pixels just outside the selected crop.
    const cropped = document.createElement('canvas');
    cropped.width = edit.width;
    cropped.height = edit.height;
    const cropContext = cropped.getContext('2d');
    if (!cropContext) throw new Error('Canvas is unavailable.');
    cropContext.drawImage(image, -edit.x, -edit.y);
    const canvas = document.createElement('canvas');
    canvas.width = plan.canvasWidth;
    canvas.height = plan.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(edit.rotation * Math.PI / 180);
    context.drawImage(cropped, -edit.outputWidth / 2, -edit.outputHeight / 2, edit.outputWidth, edit.outputHeight);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode image.')), 'image/png'));
    if (result.size > attachmentLimits.bytes) throw new Error('Edited PNG exceeds 512 KiB. Reduce the output dimensions.');
    return result;
  } finally { image.close(); }
}

const messages = {
  title: { en: 'Edit image', zh: '编辑图片' },
  close: { en: 'Close', zh: '关闭' },
  apply: { en: 'Save edited image', zh: '保存编辑后的图片' },
  cancel: { en: 'Cancel', zh: '取消' },
  x: { en: 'Crop left (px)', zh: '裁剪左边距（像素）' },
  y: { en: 'Crop top (px)', zh: '裁剪上边距（像素）' },
  width: { en: 'Crop width (px)', zh: '裁剪宽度（像素）' },
  height: { en: 'Crop height (px)', zh: '裁剪高度（像素）' },
  outputWidth: { en: 'Output width (px)', zh: '输出宽度（像素）' },
  outputHeight: { en: 'Output height (px)', zh: '输出高度（像素）' },
  rotation: { en: 'Clockwise rotation', zh: '顺时针旋转' },
  help: { en: 'Saves a derived PNG with a new content digest. Original bytes and edit parameters remain in the image history; Undo restores the previous image. Dimensions are pixels; output size is before rotation. Up to 8,192 px per side, 16 megapixels and 512 KiB. History retains at most 8 edits and 512 KiB of source files.', zh: '保存派生 PNG 并生成新的内容摘要；原始字节和编辑参数会保留在图片历史中；撤销可恢复上一张图片。尺寸单位为像素，输出尺寸指旋转前尺寸。每边最多 8,192 像素，总计 1,600 万像素及 512 KiB。历史最多保留 8 次编辑和 512 KiB 来源文件。' },
};

export function RasterEditDialog({ source, width, height, preview, onClose, onApply }: {
  source: Blob; width: number; height: number; preview: string; onClose: () => void; onApply: (blob: Blob, edit: RasterEdit) => Promise<void>;
}) {
  const { t } = useAppI18n(messages);
  const [edit, setEdit] = useState<RasterEdit>({ x: 0, y: 0, width, height, outputWidth: width, outputHeight: height, rotation: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    setError(''); setBusy(true);
    try { await onApply(await renderRasterEdit(source, edit), edit); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog title={t('title')} closeLabel={t('close')} onClose={busy ? () => {} : onClose} size="md"
    onSubmit={event => { event.preventDefault(); if (!busy) void apply(); }}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button type="submit" busy={busy}>{t('apply')}</Button></>}>
    <img className="notebook-attachment-preview" src={preview} alt="" />
    <p className="notebook-note">{t('help')}</p>
    <div className="notebook-reference-fields">
      {(['x', 'y', 'width', 'height', 'outputWidth', 'outputHeight'] as const).map(key => <Field key={key} label={t(key)}>
        {control => <Input {...control} type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={rasterLimits.side} step={1}
          disabled={busy} value={edit[key]} onChange={event => setEdit({ ...edit, [key]: Number(event.target.value) })} />}
      </Field>)}
      <Select label={t('rotation')} disabled={busy} value={String(edit.rotation)} searchable={false}
        options={[0, 90, 180, 270].map(value => ({ value: String(value), label: `${value}°` }))}
        onChange={value => setEdit({ ...edit, rotation: Number(value) })} />
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
  </Dialog>;
}
