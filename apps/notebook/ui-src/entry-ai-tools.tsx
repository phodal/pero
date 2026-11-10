import type { Editor } from '@tiptap/core';
import { useAppI18n } from '@pero/app-sdk';
import { useNotebookContext } from './notebook-context';
import { NotebookScienceTools } from './science-tools';

const messages = {
  aiTools: { en: 'AI tools', zh: 'AI 工具' },
} as const;

/** Command-row AI tools. Opens the existing science tools panel on the Host agent. */
export function EntryAiTools({ editor }: { editor: Editor }) {
  const { t } = useAppI18n(messages);
  const notebook = useNotebookContext();
  if (!notebook) return null;
  return <NotebookScienceTools editor={editor} initial="ai" label={t('aiTools')} className="notebook-ai-tools" caret
    getTarget={() => ({ entryId: notebook.entryId, revision: notebook.revision })}
    onInsert={nodes => { editor.commands.insertContent(nodes); }} />;
}
