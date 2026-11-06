import React from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@pero/app-sdk/ui';
import type { Translator } from './i18n';

/** PDF actions use the same menu, focus and collision handling as other Apps. */
export function PdfActions({ children, disabled, documentId, annotationCount, readLabel, onCapture, onNotes, onPageText, onSave, onText, t }: {
  children: React.ReactElement; disabled: boolean; documentId: string; annotationCount: number; readLabel: string;
  onCapture(): void; onNotes(): void; onPageText(): void; onSave(): void; onText(): void; t: Translator;
}) {
  if (disabled) return children;
  return <ContextMenu>
    <ContextMenuTrigger asChild unstyled onKeyDown={event => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 16, clientY: box.top + 16 }));
    }}>{children}</ContextMenuTrigger>
    <ContextMenuContent aria-label={t('pdfActions')}>
      <ContextMenuItem onSelect={onCapture}>{t('pdfCapture')}</ContextMenuItem>
      <ContextMenuItem onSelect={onNotes}>{t('pdfNotes')} {annotationCount}</ContextMenuItem>
      <ContextMenuItem onSelect={onPageText}>{t('pdfPageText')}</ContextMenuItem>
      <ContextMenuItem onSelect={() => {
        const link = window.document.createElement('a');
        link.href = `/api/pdf/${encodeURIComponent(documentId)}/file`; link.download = 'paper.pdf';
        window.document.body.append(link); link.click(); link.remove();
      }}>{t('originalPdf')}</ContextMenuItem>
      <ContextMenuItem onSelect={onSave}>{t('downloadPaper')}</ContextMenuItem>
      <ContextMenuItem onSelect={onText}>{readLabel}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
