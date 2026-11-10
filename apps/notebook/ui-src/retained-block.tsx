import type { NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { BlockFrame } from './block-frame';
import { messages } from './messages';

export function RetainedBlockView(view: NodeViewProps) {
  const { t } = useAppI18n(messages);
  const originalType = typeof view.node.attrs.originalType === 'string' ? view.node.attrs.originalType : '';
  return <BlockFrame view={view} kind="retainedBlock" title={<strong>{t('retainedBlock')}</strong>}
    caption={<span data-original-type={originalType}>{originalType}</span>}>
    <p className="notebook-note">{t('retainedBlockNote')}</p>
  </BlockFrame>;
}
