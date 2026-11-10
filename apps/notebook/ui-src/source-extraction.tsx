import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { verifiedAttachmentBytes, type AttachmentAttributes } from '@pero/notebook/attachment';
import { selectedSourceSegments, verifyExtractedSource, type ExtractedSource, type SourceExtraction } from '@pero/notebook/source-extraction';

const messages = {
  extractNote: { en: 'Extract locally from {filename}. Original bytes stay local. No models are downloaded. Files are at most 512 KiB.', zh: '从 {filename} 本地提取。原始字节保留在本地，不下载模型。文件最多 512 KiB。' },
  pdfPage: { en: 'PDF page', zh: 'PDF 页码' },
  method: { en: 'Extraction method', zh: '提取方式' },
  nativeText: { en: 'Selectable PDF text', zh: 'PDF 可选文本' },
  ocrText: { en: 'English OCR, review required', zh: '英文 OCR，需复核' },
  ocrWarning: { en: 'OCR may misread numbers, symbols and handwriting. Check the original. English Tesseract must be installed locally.', zh: 'OCR 可能误读数字、符号和手写内容，请核对原件。需本地英文 Tesseract。' },
  extracting: { en: 'Extracting locally…', zh: '正在本地提取…' },
  extract: { en: 'Extract source locally', zh: '本地提取来源' },
  provenance: { en: 'Extraction provenance and limitations', zh: '提取来源与局限' },
  parts: { en: '{count} source parts intersect this selection.', zh: '此选区涉及 {count} 个来源位置。' },
} as const;

/** Only a deliberate button click invokes a local parser. Nothing goes to an Agent here. */
export function SourceExtractionPicker({ file, disabled = false, onExtract, onReset }: {
  file: AttachmentAttributes; disabled?: boolean; onExtract(value: ExtractedSource): void; onReset?(): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages), [mode, setMode] = useState(file.mime.startsWith('image/') ? 'ocr' : 'native'), [page, setPage] = useState('1');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), generation = useRef(0), running = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const extract = async () => {
    if (running.current || disabled) return;
    const request = ++generation.current; running.current = true; setBusy(true); setError('');
    try {
      await verifiedAttachmentBytes(file);
      const { filename, mime, data, sha256 } = file;
      const result = await verifyExtractedSource(await api.post('/api/source-extraction', { file: { filename, mime, data, sha256 }, mode, page: Number(page) }), sha256);
      if (generation.current === request) onExtract(result);
    } catch (cause) { if (generation.current === request) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation.current === request) { setBusy(false); running.current = false; } }
  };
  return <div className="notebook-science-fields">
    <p className="notebook-note">{t('extractNote', { filename: file.filename })}</p>
    {file.mime === 'application/pdf' && <>
      <Field label={t('pdfPage')}>{control => <Input {...control} type="number" min={1} max={500} step={1} value={page} disabled={busy || disabled} onChange={event => { setPage(event.target.value); onReset?.(); }} />}</Field>
      <Field label={t('method')}>{control => <NativeSelect {...control} value={mode} disabled={busy || disabled} onChange={event => { setMode(event.target.value); onReset?.(); }}><option value="native">{t('nativeText')}</option><option value="ocr">{t('ocrText')}</option></NativeSelect>}</Field>
    </>}
    {mode === 'ocr' && <Feedback kind="warning">{t('ocrWarning')}</Feedback>}
    <Button disabled={disabled || busy || !/^[1-9]\d*$/.test(page) || Number(page) > 500} onClick={() => void extract()}>{busy ? t('extracting') : t('extract')}</Button>
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}

export function SourceExtractionDetails({ extraction, start = 0, end = Infinity }: { extraction: SourceExtraction; start?: number; end?: number }) {
  const { t } = useAppI18n(messages);
  const parts = selectedSourceSegments(extraction, start, end);
  return <Disclosure summary={t('provenance')}>
    <p>{extraction.parser.name} {extraction.parser.version} · {extraction.method}</p>
    <p>Original SHA-256: {extraction.original.sha256}<br />Text SHA-256: {extraction.textSha256}</p>
    {extraction.limitations.map((limitation, index) => <p key={index} className="notebook-note">{limitation}</p>)}
    <p>{t('parts', { count: parts.length })}</p>
    <pre className="notebook-science-json">{JSON.stringify(parts, null, 2)}</pre>
  </Disclosure>;
}
