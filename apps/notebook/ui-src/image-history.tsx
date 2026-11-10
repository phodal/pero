import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { useState } from 'react';
import { attachmentBytes, type ImageDerivation } from '@pero/notebook/attachment';

const messages = {
  history: { en: 'Image history ({count})', zh: '图片历史（{count} 次编辑）' },
  verified: { en: 'Embedded file digests match. Edit parameters are recorded locally, not independently replayed or externally attested.', zh: '嵌入文件的摘要匹配。编辑参数是本地记录，未经独立重放或外部认证。' },
  source: { en: 'Download source image {index}', zh: '下载第 {index} 张来源图片' },
  operation: { en: 'Source {width} × {height} px; crop ({x}, {y}, {cropWidth}, {cropHeight}); resize {outputWidth} × {outputHeight} px; rotate {rotation}° clockwise.', zh: '来源 {width} × {height} 像素；裁剪（{x}、{y}、{cropWidth}、{cropHeight}）；缩放至 {outputWidth} × {outputHeight} 像素；顺时针旋转 {rotation}°。' },
  hashes: { en: 'Source SHA-256: {source}. Output SHA-256: {output}.', zh: '来源 SHA-256：{source}。输出 SHA-256：{output}。' },
  failed: { en: 'The download could not start. Try again.', zh: '未能开始下载，请重试。' },
};

/** Mounted only after the attachment owner verifies all embedded source and output bytes. */
export function ImageHistory({ derivation }: { derivation: ImageDerivation }) {
  const { t } = useAppI18n(messages);
  const [failed, setFailed] = useState(false);
  return <details>
    <summary>{t('history', { count: derivation.steps.length })}</summary>
    <p className="notebook-note">{t('verified')}</p>
    <ol>{derivation.steps.map((step, index) => <li key={index}>
      <strong>{step.source.filename}</strong>
      <p className="notebook-note">{t('operation', { width: step.sourceWidth, height: step.sourceHeight,
        x: step.edit.x, y: step.edit.y, cropWidth: step.edit.width, cropHeight: step.edit.height,
        outputWidth: step.edit.outputWidth, outputHeight: step.edit.outputHeight, rotation: step.edit.rotation })}</p>
      <p className="notebook-note" style={{ overflowWrap: 'anywhere' }}>{t('hashes', { source: step.source.sha256, output: step.outputSha256 })}</p>
      <Button variant="ghost" onClick={() => {
        setFailed(false);
        try { downloadFile(step.source.filename, attachmentBytes(step.source.data), 'application/octet-stream'); }
        catch { setFailed(true); }
      }}>{t('source', { index: index + 1 })}</Button>
    </li>)}</ol>
    {failed && <Feedback kind="error">{t('failed')}</Feedback>}
  </details>;
}
