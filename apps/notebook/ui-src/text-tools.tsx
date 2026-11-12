import { NotebookMenu } from './notebook-menu';
import { EntryAiTools } from './entry-ai-tools';
import { NOTEBOOK_SYMBOLS_EVENT } from './notebook-commands';
import { Extension, getMarkRange, Mark, type Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { AllSelection, Plugin } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Field, Icon, IconButton, Input, Select, Toolbar } from '@pero/app-sdk/ui';
const textTones = ['blue', 'green', 'rose', 'amber', 'orange', 'violet'] as const;
export const notebookColorOptions = ['default', ...textTones] as const;
type TextTone = typeof textTones[number];

/** Persist semantic colors, never arbitrary CSS from a pasted document. */
function semanticColor(name: string, attribute: string, classPrefix: string) {
  return Mark.create({
    name,
    addAttributes() { return { tone: { default: null, rendered: false, parseHTML: () => null } }; },
    parseHTML() {
      return [{ tag: `span[${attribute}]`, getAttrs: element => {
        const tone = element.getAttribute(attribute);
        return textTones.includes(tone as TextTone) ? { tone } : false;
      } }];
    },
    renderHTML({ mark }) {
      return textTones.includes(mark.attrs.tone) ? ['span', {
        [attribute]: mark.attrs.tone, class: `${classPrefix}-${mark.attrs.tone}`,
      }, 0] : ['span', 0];
    },
  });
}
export const NotebookTextColor = semanticColor('textColor', 'data-notebook-text-color', 'notebook-text');
export const NotebookTextBackground = semanticColor('textBackground', 'data-notebook-text-background', 'notebook-background');

export const NotebookSubscript = Mark.create({
  name: 'subscript',
  excludes: 'subscript superscript',
  parseHTML() { return [{ tag: 'sub' }]; },
  renderHTML() { return ['sub', 0]; },
  addKeyboardShortcuts() { return { 'Mod-,': () => this.editor.chain().unsetMark('superscript').toggleMark(this.name).run() }; },
});

export const NotebookSuperscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript superscript',
  parseHTML() { return [{ tag: 'sup' }]; },
  renderHTML() { return ['sup', 0]; },
  addKeyboardShortcuts() { return { 'Mod-.': () => this.editor.chain().unsetMark('subscript').toggleMark(this.name).run() }; },
});

/** Shared by the dialog and StarterKit's link parser, paste and mark commands. */
export function isNotebookLinkUri(value: string): boolean {
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'mailto:' ? url.pathname.length > 0 : !!url.hostname;
  } catch { return false; }
}

export const notebookLinkOptions = {
  openOnClick: false,
  autolink: false,
  linkOnPaste: true,
  defaultProtocol: 'https',
  isAllowedUri: isNotebookLinkUri,
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
};

/** Pasted links keep their text and destination, not another site's presentation. */
export const NotebookLinkPaste = Extension.create({
  name: 'notebookLinkPaste',
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      transformPasted(slice) {
        const normalize = (fragment: Fragment): Fragment => {
          const nodes = [];
          for (const node of fragment.content) {
            const marks = node.marks.flatMap(mark => {
              if (mark.type.name !== 'link') return [mark];
              const href = mark.attrs.href;
              return isNotebookLinkUri(href) ? [mark.type.create({
                href, ...notebookLinkOptions.HTMLAttributes, title: null,
              })] : [];
            });
            nodes.push((node.isLeaf ? node : node.copy(normalize(node.content))).mark(marks));
          }
          return Fragment.fromArray(nodes);
        };
        return new Slice(normalize(slice.content), slice.openStart, slice.openEnd);
      },
    } })];
  },
});

export const NOTEBOOK_LINK_EVENT = 'pero:notebook-link';

export const messages = {
  format: { en: 'Formatting', zh: '格式' },
  editing: { en: 'Editing', zh: '编辑' },
  style: { en: 'Style', zh: '样式' },
  paragraph: { en: 'Paragraph', zh: '段落' },
  heading: { en: 'Heading {level}', zh: '{level} 级标题' },
  bulletList: { en: 'Bullet list', zh: '项目列表' },
  orderedList: { en: 'Numbered list', zh: '编号列表' },
  taskList: { en: 'Checklist', zh: '检查清单' },
  blockquote: { en: 'Quote', zh: '引用' },
  codeBlock: { en: 'Code block', zh: '代码块' },
  horizontalRule: { en: 'Divider', zh: '分隔线' },
  bold: { en: 'Bold', zh: '粗体' },
  italic: { en: 'Italic', zh: '斜体' },
  underline: { en: 'Underline', zh: '下划线' },
  strike: { en: 'Strikethrough', zh: '删除线' },
  code: { en: 'Inline code', zh: '行内代码' },
  subscript: { en: 'Subscript', zh: '下标' },
  superscript: { en: 'Superscript', zh: '上标' },
  textColor: { en: 'Text color', zh: '文字颜色' },
  textBackground: { en: 'Highlight', zh: '文字高亮' },
  default: { en: 'Default', zh: '默认' },
  blue: { en: 'Blue', zh: '蓝色' },
  green: { en: 'Green', zh: '绿色' },
  rose: { en: 'Rose', zh: '玫红' },
  amber: { en: 'Amber', zh: '琥珀色' },
  orange: { en: 'Orange', zh: '橙色' },
  violet: { en: 'Violet', zh: '紫色' },
  clear: { en: 'Clear formatting', zh: '清除格式' },
  indent: { en: 'Indent list item', zh: '增加列表缩进' },
  outdent: { en: 'Outdent list item', zh: '减少列表缩进' },
  insertLink: { en: 'Insert link', zh: '插入链接' },
  editLink: { en: 'Edit link', zh: '编辑链接' },
  removeLink: { en: 'Remove link', zh: '移除链接' },
  linkAddress: { en: 'Link address', zh: '链接地址' },
  linkHelp: { en: 'Use an https://, http:// or mailto: address, up to 2,048 characters.', zh: '使用 https://、http:// 或 mailto: 地址，最多 2,048 个字符。' },
  invalidLink: { en: 'Enter a valid http://, https:// or mailto: address.', zh: '请输入有效的 http://、https:// 或 mailto: 地址。' },
  linkText: { en: 'Link text', zh: '链接文字' },
  linkTextHelp: { en: 'Leave blank to use the address.', zh: '留空则显示链接地址。' },
  apply: { en: 'Apply link', zh: '应用链接' },
  cancel: { en: 'Cancel', zh: '取消' },
  close: { en: 'Close', zh: '关闭' },
  symbols: { en: 'Insert symbol', zh: '插入符号' },
  more: { en: 'More formatting', zh: '更多格式' },
  symbolLabel: { en: 'Insert {symbol} ({name})', zh: '插入 {symbol}（{name}）' },
  greek: { en: 'Greek letters', zh: '希腊字母' },
  mathematical: { en: 'Mathematics and units', zh: '数学与单位' },
} as const;

const marks = ['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript'] as const;
export const notebookBlockStyles = ['bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'] as const;
const headingLevels = [1, 2, 3, 4, 5, 6] as const;
type HeadingLevel = typeof headingLevels[number];
const glyphs = {
  bold: <Icon name="bold" />, italic: <Icon name="italic" />, underline: <u aria-hidden="true">U</u>,
  strike: <s aria-hidden="true">S</s>, code: <Icon name="code" />,
  subscript: <span aria-hidden="true">x<sub>2</sub></span>, superscript: <span aria-hidden="true">x<sup>2</sup></span>,
};
const symbols = {
  greek: [
    ['α', 'alpha', '阿尔法'], ['β', 'beta', '贝塔'], ['γ', 'gamma', '伽马'], ['δ', 'delta', '德尔塔'],
    ['ε', 'epsilon', '艾普西隆'], ['θ', 'theta', '西塔'], ['λ', 'lambda', '兰姆达'], ['μ', 'mu', '缪'],
    ['π', 'pi', '派'], ['ρ', 'rho', '柔'], ['σ', 'sigma', '西格玛'], ['τ', 'tau', '陶'],
    ['φ', 'phi', '斐'], ['χ', 'chi', '希'], ['ψ', 'psi', '普西'], ['ω', 'omega', '欧米伽'],
    ['Δ', 'capital delta', '大写德尔塔'], ['Σ', 'capital sigma', '大写西格玛'], ['Ω', 'capital omega', '大写欧米伽'],
  ],
  mathematical: [
    ['±', 'plus or minus', '正负号'], ['×', 'multiplication', '乘号'], ['÷', 'division', '除号'], ['·', 'middle dot', '中点'],
    ['≤', 'less than or equal', '小于等于'], ['≥', 'greater than or equal', '大于等于'], ['≠', 'not equal', '不等于'],
    ['≈', 'approximately equal', '约等于'], ['∞', 'infinity', '无穷'], ['√', 'square root', '平方根'],
    ['∑', 'summation', '求和'], ['∫', 'integral', '积分'], ['∂', 'partial derivative', '偏导数'],
    ['→', 'right arrow', '右箭头'], ['⇌', 'equilibrium', '平衡箭头'], ['°', 'degree', '度'],
    ['µ', 'micro', '微'], ['Å', 'angstrom', '埃'], ['‰', 'per mille', '千分号'],
  ],
} as const;

type Range = { from: number; to: number };
type TextDialog = { kind: 'symbols'; selection: Range } | {
  kind: 'link'; selection: Range; range: Range; existing: boolean; href: string; text: string; error: boolean;
};

/** Format controls are composed into the editor's existing Toolbar. */
export function NotebookTextTools({ editor, entryTools = false }: { editor: Editor; entryTools?: boolean }) {
  const { t, locale } = useAppI18n(messages);
  const [dialog, setDialog] = useState<TextDialog | null>(null);
  const returnToEditor = useRef(false);
  const status = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const { $from, $to } = instance.state.selection;
      let format = $from.parent.type.name === 'heading' ? `heading-${$from.parent.attrs.level}` : $from.parent.type.name;
      let listItem: 'taskItem' | 'listItem' | null = null;
      for (let depth = $from.depth; depth > 0; depth--) {
        const name = $from.node(depth).type.name;
        if (!listItem && (name === 'taskItem' || name === 'listItem')) listItem = name;
        if (format === 'paragraph' && notebookBlockStyles.includes(name as typeof notebookBlockStyles[number])) format = name;
      }
      const inline = $from.parent.inlineContent && $to.parent.inlineContent;
      const text = inline || instance.state.selection instanceof AllSelection;
      return {
        editable: instance.isEditable, text, inline, format,
        marks: marks.filter(mark => instance.isActive(mark)),
        enabledMarks: text ? marks.filter(mark => instance.can().toggleMark(mark)
          || (mark === 'subscript' && instance.isActive('superscript'))
          || (mark === 'superscript' && instance.isActive('subscript'))) : [],
        tone: instance.getAttributes('textColor').tone ?? 'default',
        background: instance.getAttributes('textBackground').tone ?? 'default',
        link: instance.isActive('link'),
        canLink: inline && instance.can().setLink({ href: 'https://example.org' }),
        listItem,
        canIndent: listItem !== null && instance.can().sinkListItem(listItem),
        canOutdent: listItem !== null && instance.can().liftListItem(listItem),
      };
    },
  });
  useLayoutEffect(() => {
    if (!dialog && returnToEditor.current) {
      returnToEditor.current = false;
      if (!editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false });
    }
  }, [dialog, editor]);
  useEffect(() => {
    const openSymbols = () => {
      const { from, to, $from, $to } = editor.state.selection;
      if (!editor.isDestroyed && editor.isEditable && $from.parent.inlineContent && $to.parent.inlineContent) setDialog({ kind: 'symbols', selection: { from, to } });
    };
    const openLinkFromMenu = () => {
      if (editor.isDestroyed || !editor.isEditable) return;
      const { from, to, $from, empty } = editor.state.selection;
      const existing = editor.isActive('link');
      const range = existing && empty ? getMarkRange($from, editor.schema.marks.link) ?? { from, to } : { from, to };
      setDialog({ kind: 'link', selection: { from, to }, range, existing,
        href: existing ? editor.getAttributes('link').href : '', text: '', error: false });
    };
    const element = editor.view.dom;
    element.addEventListener(NOTEBOOK_SYMBOLS_EVENT, openSymbols);
    element.addEventListener(NOTEBOOK_LINK_EVENT, openLinkFromMenu);
    return () => {
      element.removeEventListener(NOTEBOOK_SYMBOLS_EVENT, openSymbols);
      element.removeEventListener(NOTEBOOK_LINK_EVENT, openLinkFromMenu);
    };
  }, [editor]);
  if (!status.editable) return null;

  const closeDialog = () => { returnToEditor.current = true; setDialog(null); };
  const chooseFormat = (format: string) => {
    const command = editor.chain().focus();
    if (format.startsWith('heading-')) {
      command.clearNodes().setHeading({ level: Number(format.slice(8)) as HeadingLevel }).run();
      return;
    }
    switch (format) {
      case 'paragraph': command.clearNodes().setParagraph().run(); break;
      case 'bulletList': command.toggleBulletList().run(); break;
      case 'orderedList': command.toggleOrderedList().run(); break;
      case 'taskList': command.toggleTaskList().run(); break;
      case 'blockquote': command.toggleBlockquote().run(); break;
      case 'codeBlock': command.toggleCodeBlock().run(); break;
    }
  };
  const openLink = () => {
    const { from, to, $from, empty } = editor.state.selection;
    const existing = editor.isActive('link');
    const range = existing && empty ? getMarkRange($from, editor.schema.marks.link) ?? { from, to } : { from, to };
    setDialog({ kind: 'link', selection: { from, to }, range, existing,
      href: existing ? editor.getAttributes('link').href : '', text: '', error: false });
  };
  const applyLink = () => {
    if (dialog?.kind !== 'link') return;
    const href = dialog.href.trim();
    if (!isNotebookLinkUri(href)) { setDialog({ ...dialog, error: true }); return; }
    const command = editor.chain().setTextSelection(dialog.range);
    if (dialog.range.from === dialog.range.to) {
      command.insertContent({ type: 'text', text: dialog.text || href, marks: [{ type: 'link', attrs: {
        href, ...notebookLinkOptions.HTMLAttributes, title: null,
      } }] }).unsetLink().run();
    } else {
      command.setLink({ href, ...notebookLinkOptions.HTMLAttributes, title: null }).setTextSelection(dialog.selection).run();
    }
    closeDialog();
  };

  const headingValue = status.format.startsWith('heading-') ? status.format : '';
  const colorSelect = (mark: 'textColor' | 'textBackground', value: string) => {
    const foreground = mark === 'textColor';
    return <Select className="notebook-color-select" label={t(mark)} title={t(mark)} value={value}
      disabled={!status.text || !editor.can().setMark(mark, { tone: 'blue' })} searchable={false}
      leading={foreground
        ? <span aria-hidden="true" className={`notebook-color-glyph notebook-text-${value}`}>A</span>
        : <span aria-hidden="true" className={`notebook-highlight-glyph notebook-background-${value}`}>A</span>}
      options={notebookColorOptions.map(tone => ({ value: tone, label: t(tone),
        leading: <span className={`notebook-swatch notebook-swatch-${foreground ? 'ink' : 'fill'} notebook-${foreground ? 'text' : 'background'}-${tone}`} />,
      }))}
      onChange={tone => {
        const command = editor.chain().focus();
        if (tone === 'default') command.unsetMark(mark).run();
        else command.setMark(mark, { tone }).run();
      }} />;
  };
  const toggleMark = (mark: typeof marks[number]) => {
    const command = editor.chain().focus();
    if (mark === 'subscript') command.unsetMark('superscript');
    if (mark === 'superscript') command.unsetMark('subscript');
    command.toggleMark(mark).run();
  };
  const markButton = (mark: typeof marks[number]) => <IconButton key={mark} label={t(mark)} aria-pressed={status.marks.includes(mark)}
    disabled={!status.enabledMarks.includes(mark)} onMouseDown={event => event.preventDefault()} onClick={() => toggleMark(mark)}>{glyphs[mark]}</IconButton>;
  const blockButton = (block: typeof notebookBlockStyles[number], icon: 'bullet' | 'ordered' | 'task' | 'quote' | 'code') => <IconButton key={block} label={t(block)} aria-pressed={status.format === block}
    disabled={!status.text} onMouseDown={event => event.preventDefault()} onClick={() => chooseFormat(block)}><Icon name={icon} /></IconButton>;

  return <div className="notebook-format">
    <Toolbar className="notebook-toolbar" role="group" aria-label={t('format')}>
    <Select className="notebook-heading-select" label={t('format')} value={status.format} disabled={!status.text} searchable={false} title={t('style')}
      leading={<span aria-hidden="true" className="notebook-heading-mark">{headingValue.startsWith('heading-') ? `H${headingValue.slice(8)}` : 'H'}</span>}
      options={[
        { value: 'paragraph', label: t('paragraph') },
        ...headingLevels.map(level => ({ value: `heading-${level}`, label: t('heading', { level }) })),
        ...notebookBlockStyles.map(block => ({ value: block, label: t(block) })),
      ]} onChange={chooseFormat} />
    {markButton('bold')}
    {markButton('italic')}
    {markButton('underline')}
    <IconButton label={t(status.link ? 'editLink' : 'insertLink')} aria-pressed={status.link} disabled={!status.canLink}
      onMouseDown={event => event.preventDefault()} onClick={openLink}><Icon name="link" /></IconButton>
    <span className="notebook-toolbar-divider" />
    {blockButton('bulletList', 'bullet')}
    {blockButton('orderedList', 'ordered')}
    {blockButton('taskList', 'task')}
    </Toolbar>
    {entryTools && <EntryAiTools editor={editor} />}
    <NotebookMenu name={t('more')} menu="format" icon="more" triggerClassName="notebook-overflow-trigger">
      <div className="notebook-workspace-actions">{markButton('strike')}{markButton('subscript')}{markButton('superscript')}</div>
      {colorSelect('textColor', status.tone)}
      {editor.schema.marks.textBackground && colorSelect('textBackground', status.background)}
      <Button variant="ghost" aria-pressed={status.marks.includes('code')} disabled={!status.enabledMarks.includes('code')}
        onMouseDown={event => event.preventDefault()} onClick={() => toggleMark('code')}>{t('code')}</Button>
      {editor.schema.nodes.horizontalRule && <Button variant="ghost" disabled={!status.inline || !editor.can().setHorizontalRule()}
        onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().setHorizontalRule().run()}>{t('horizontalRule')}</Button>}
      <Button variant="ghost" aria-label={t('indent')} disabled={!status.canIndent} onMouseDown={event => event.preventDefault()}
        onClick={() => status.listItem && editor.chain().focus().sinkListItem(status.listItem).run()}>{t('indent')}</Button>
      <Button variant="ghost" aria-label={t('outdent')} disabled={!status.canOutdent} onMouseDown={event => event.preventDefault()}
        onClick={() => status.listItem && editor.chain().focus().liftListItem(status.listItem).run()}>{t('outdent')}</Button>
      <Button variant="ghost" aria-label={t('clear')} disabled={!status.text} onMouseDown={event => event.preventDefault()}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>{t('clear')}</Button>
      <Button variant="ghost" aria-label={t('symbols')} disabled={!status.inline} onMouseDown={event => event.preventDefault()}
        onClick={() => { const { from, to } = editor.state.selection; setDialog({ kind: 'symbols', selection: { from, to } }); }}>{t('symbols')}</Button>
    </NotebookMenu>
    {dialog?.kind === 'link' && <Dialog title={t(dialog.existing ? 'editLink' : 'insertLink')} closeLabel={t('close')}
      size="sm" restoreFocus={false} onClose={closeDialog} onSubmit={event => { event.preventDefault(); applyLink(); }}
      footerStart={dialog.existing && <Button variant="ghost" onClick={() => {
        editor.chain().setTextSelection(dialog.range).unsetLink().setTextSelection(dialog.selection).run(); closeDialog();
      }}>{t('removeLink')}</Button>}
      footer={<><Button variant="ghost" onClick={closeDialog}>{t('cancel')}</Button><Button type="submit" variant="primary">{t('apply')}</Button></>}>
      <Field label={t('linkAddress')} description={t('linkHelp')} error={dialog.error ? t('invalidLink') : undefined}>
        {control => <Input {...control} value={dialog.href} maxLength={2048} autoComplete="off" spellCheck={false}
          onChange={event => setDialog({ ...dialog, href: event.target.value, error: false })} />}
      </Field>
      {dialog.range.from === dialog.range.to && <Field label={t('linkText')} description={t('linkTextHelp')}>
        {control => <Input {...control} value={dialog.text} maxLength={2048} onChange={event => setDialog({ ...dialog, text: event.target.value })} />}
      </Field>}
    </Dialog>}
    {dialog?.kind === 'symbols' && <Dialog title={t('symbols')} closeLabel={t('close')} size="sm" restoreFocus={false}
      initialFocus=".notebook-symbols button" onClose={closeDialog} footer={<Button variant="ghost" onClick={closeDialog}>{t('cancel')}</Button>}>
      {(Object.keys(symbols) as Array<keyof typeof symbols>).map(group => <section key={group} aria-label={t(group)}>
        <p className="notebook-note">{t(group)}</p>
        <div className="notebook-symbols">
          {symbols[group].map(([symbol, en, zh]) => <Button key={symbol} variant="ghost"
            aria-label={t('symbolLabel', { symbol, name: locale === 'zh' ? zh : en })}
            title={locale === 'zh' ? zh : en} onClick={() => {
              editor.chain().setTextSelection(dialog.selection).command(({ tr }) => { tr.insertText(symbol); return true; }).run();
              closeDialog();
            }}>{symbol}</Button>)}
        </div>
      </section>)}
    </Dialog>}
  </div>;
}
