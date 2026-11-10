import CodeBlock from '@tiptap/extension-code-block';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, CodeEditor, Select } from '@pero/app-sdk/ui';
import { rememberWidgetFocus } from './block-order';

export const notebookCodeLanguages = ['plaintext', 'python', 'javascript'] as const;
const messages = {
  language: { en: 'Code language', zh: '代码语言' },
  code: { en: 'Code', zh: '代码' },
  plaintext: { en: 'Plain text', zh: '纯文本' },
  remove: { en: 'Remove code block', zh: '删除代码块' },
};

function CodeBlockView(view: NodeViewProps) {
  const { t } = useAppI18n(messages);
  const editable = useEditorState({ editor: view.editor, selector: ({ editor }) => editor.isEditable });
  const language = notebookCodeLanguages.includes(view.node.attrs.language) ? view.node.attrs.language : 'plaintext';
  return <NodeViewWrapper className="notebook-block notebook-code-block" contentEditable={false}
    data-notebook-block-id={view.node.attrs.blockId ?? undefined}
    onFocusCapture={() => rememberWidgetFocus(view.editor, view.node.attrs.blockId)}>
    <div className="notebook-block-header">
      <Select label={t('language')} value={language} disabled={!editable} searchable={false}
        options={notebookCodeLanguages.map(value => ({ value, label: value === 'plaintext' ? t('plaintext') : value === 'python' ? 'Python' : 'JavaScript' }))}
        onChange={value => view.editor.isEditable && view.updateAttributes({ language: value })} />
      {editable && <Button variant="ghost" onClick={view.deleteNode}>{t('remove')}</Button>}
    </div>
    <CodeEditor label={t('code')} language={language} value={view.node.textContent} disabled={!editable}
      onChange={text => {
        const position = view.getPos();
        if (!view.editor.isEditable || typeof position !== 'number' || view.node.textContent === text) return;
        view.editor.view.dispatch(view.editor.state.tr.replaceWith(position + 1, position + view.node.nodeSize - 1,
          text ? view.editor.schema.text(text) : []));
      }} />
  </NodeViewWrapper>;
}

/** Keep StarterKit's text model, commands, fenced input and HTML exchange. No execution authority. */
export const NotebookCodeBlock = CodeBlock.extend({
  addAttributes() {
    return { language: {
      default: 'plaintext',
      parseHTML: element => {
        const language = Array.from(element.firstElementChild?.classList ?? [])
          .find(value => value.startsWith('language-'))?.slice(9);
        return notebookCodeLanguages.includes(language as typeof notebookCodeLanguages[number]) ? language : 'plaintext';
      },
      rendered: false,
    } };
  },
  addNodeView() { return ReactNodeViewRenderer(CodeBlockView); },
});
