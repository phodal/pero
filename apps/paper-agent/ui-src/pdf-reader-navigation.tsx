import React from 'react';

/** Reader input (including portal toolbar events) supersedes a pending reveal.
 * The explicit checked-receipt source action is part of that reveal. */
export function PdfReaderNavigation({ view, receiptId, onNavigate, children }: {
  view: string; receiptId?: string; onNavigate(): void; children: React.ReactNode;
}) {
  const capture = (event: React.SyntheticEvent) => {
    const target = event.target instanceof Element ? event.target.closest('button[data-fisher-receipt-source]') : null;
    const activates = event.type !== 'keydown' || ['Enter', ' '].includes((event as React.KeyboardEvent).key);
    if (activates && receiptId && target?.getAttribute('data-fisher-receipt-source') === receiptId) return;
    onNavigate();
  };
  return <div className="pa-pdf-reading" data-reader-view={view} onPointerDownCapture={capture}
    onClickCapture={capture} onKeyDownCapture={capture} onWheelCapture={onNavigate} onChangeCapture={onNavigate}>
    {children}
  </div>;
}
