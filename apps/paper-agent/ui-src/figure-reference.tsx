import React, { useEffect, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback } from '@pero/app-sdk/ui';
import type { Api, PdfFocus } from './types';

export type FigureReference = {
  archiveDigest: string; memberId: string; memberPath: string; bundleId: string; resourceId: string;
  figures: { texMemberId: string; texPath: string; startLine: number; endLine: number; caption: string }[];
  preview: null | (PdfFocus & { previewId: string; paperId: string });
  pdf: null | (PdfFocus & { paperId: string });
};
export type FigureTarget = FigureReference & { token: number };

export function FigureSourceDialog({ api, reference, onClose }: { api: Api; reference: FigureReference; onClose(): void }) {
  const { t } = useAppI18n({
    title: { zh: '图表来源', en: 'Figure source' }, close: { zh: '关闭来源', en: 'Close source' },
    loading: { zh: '正在读取原图与源码…', en: 'Reading original figure and source…' },
    retry: { zh: '重试', en: 'Retry' },
    noPage: { zh: '未找到唯一的排版页位置，以下为原图和对应源码。', en: 'No unique typeset page was found. Original figure and source follow.' },
    noAssociation: { zh: '未找到唯一的 TeX 图片引用。', en: 'No unambiguous TeX image reference was found.' },
    lines: { zh: '第 {start}–{end} 行', en: 'Lines {start}–{end}' },
  });
  const [value, setValue] = useState<{ image: string; sources: string[] } | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true; setValue(null); setError('');
    const read = <T,>(input: object) => api.post<T>('/api/research/source-read', { bundleId: reference.bundleId, resourceId: reference.resourceId, ...input });
    Promise.all([
      read<{ mimeType: string; data: string }>({ operation: 'image', memberId: reference.memberId }),
      Promise.all(reference.figures.map(figure => read<{ content: string }>({ operation: 'read', memberId: figure.texMemberId, startLine: figure.startLine, endLine: figure.endLine }))),
    ]).then(([image, sources]) => { if (alive) setValue({ image: `data:${image.mimeType};base64,${image.data}`, sources: sources.map(source => source.content) }); }, error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, [api, reference, attempt]);
  return <Dialog title={t('title')} closeLabel={t('close')} size="lg" onClose={onClose}>
    <p>{reference.memberPath}</p><p className="pa-muted">{t('noPage')}</p>
    {error ? <Feedback kind="error"><p>{error}</p><Button onClick={() => setAttempt(n => n + 1)}>{t('retry')}</Button></Feedback> : !value ? <p role="status">{t('loading')}</p> : <>
      <img className="pa-source-image" src={value.image} alt={reference.memberPath}/>
      {!reference.figures.length && <p>{t('noAssociation')}</p>}
      {reference.figures.map((figure, index) => <section key={`${figure.texMemberId}:${figure.startLine}`}>
        <p>{figure.caption}</p><p>{figure.texPath} / {t('lines', { start: figure.startLine, end: figure.endLine })}</p>
        <pre className="pa-source-text" tabIndex={0}>{value.sources[index]}</pre>
      </section>)}
    </>}
  </Dialog>;
}
