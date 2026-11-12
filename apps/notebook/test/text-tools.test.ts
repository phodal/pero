import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('Notebook text controls edit real marks, block structures and selected text', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `
      export * from './text-tools';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      export { Editor } from '@tiptap/core';
      export { Slice } from '@tiptap/pm/model';
      export { default as StarterKit } from '@tiptap/starter-kit';
      export { default as TaskList } from '@tiptap/extension-task-list';
      export { default as TaskItem } from '@tiptap/extension-task-item';
    `,
  });
  const { React, ui, render, click, dom } = runtime;
  const { Editor, StarterKit, TaskItem, TaskList, NotebookTextTools, NotebookTextColor, NotebookTextBackground,
    NotebookSubscript, NotebookSuperscript, NotebookLinkPaste, notebookLinkOptions, isNotebookLinkUri } = ui;
  // jsdom has no top layer; retain the modal's native focus/close contract.
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true; this.__previousFocus = document.activeElement;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false; this.__previousFocus?.focus();
  };
  const element = document.createElement('div');
  document.body.append(element);
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  editor = new Editor({
    element,
    extensions: [StarterKit.configure({ link: notebookLinkOptions, trailingNode: false }), TaskList,
      TaskItem.configure({ nested: true }), NotebookTextColor, NotebookTextBackground, NotebookSubscript, NotebookSuperscript, NotebookLinkPaste],
    content: '<p>Assay result</p>',
  });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(NotebookTextTools, { editor })));
  const act = (operation: () => void) => React.act(async () => { operation(); });
  const button = (label: string) => {
    const control = document.querySelector(`button[aria-label="${label}"]`);
    assert.ok(control, `Missing button: ${label}`);
    return control;
  };
  const textButton = (label: string) => {
    const control = [...document.querySelectorAll('button')].find(item => item.textContent === label);
    assert.ok(control, `Missing button: ${label}`);
    return control;
  };
  const reset = async (content = '<p>Assay result</p>', selection = { from: 1, to: 6 }) => act(() => {
    editor.commands.setContent(content); editor.commands.setTextSelection(selection);
  });
  const select = async (label: string, value: string) => {
    button(label).getBoundingClientRect = () => ({ x: 10, y: 10, width: 120, height: 30, top: 10, left: 10, right: 130, bottom: 40, toJSON() { return this; } });
    await click(button(label));
    const option = document.querySelector(`[role=option][data-value="${value}"]`)
      ?? [...document.querySelectorAll('.pero-ui-color-picker-option')].find(item => {
        const text = item.textContent ?? '';
        if (value === 'default') return text.includes('Default');
        return text.toLowerCase().includes(value);
      });
    assert.ok(option, `Missing option: ${value}`);
    await click(option);
  };
  const fill = async (label: string, value: string) => {
    const caption = [...document.querySelectorAll('label')].find(item => item.textContent === label);
    assert.ok(caption);
    const control = document.getElementById(caption.htmlFor);
    assert.ok(control);
    await act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(control, value);
      control.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const submit = async () => act(() => {
    document.querySelector('dialog form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  const marks = () => JSON.parse(JSON.stringify(editor.getJSON().content[0].content[0].marks ?? []));

  await t.test('underline, scripts, colors and clear formatting retain text', async () => {
    await reset();
    await click(button('Underline'));
    assert.deepEqual(marks(), [{ type: 'underline' }]);
    await click(button('Subscript'));
    await click(button('Superscript'));
    assert.deepEqual(marks(), [{ type: 'underline' }, { type: 'superscript' }]);
    await click(button('Subscript'));
    assert.deepEqual(marks(), [{ type: 'underline' }, { type: 'subscript' }]);
    for (const tone of ['blue', 'green', 'rose', 'amber', 'orange', 'violet']) {
      await select('Text color', tone);
      assert.ok(marks().some((mark: { type: string; attrs?: { tone: string } }) => mark.type === 'textColor' && mark.attrs?.tone === tone));
      assert.match(editor.getHTML(), new RegExp(`class="notebook-text-${tone}"`));
    }
    await select('Text color', 'default');
    assert.ok(!marks().some((mark: { type: string }) => mark.type === 'textColor'));
    await select('Highlight', 'violet');
    assert.ok(marks().some((mark: { type: string; attrs?: { tone: string } }) => mark.type === 'textBackground' && mark.attrs?.tone === 'violet'));
    button('Text color').getBoundingClientRect = () => ({ x: 10, y: 10, width: 120, height: 30, top: 10, left: 10, right: 130, bottom: 40, toJSON() { return this; } });
    await click(button('Text color'));
    const hex = document.querySelector('.pero-ui-color-picker-hex input') as HTMLInputElement;
    assert.ok(hex);
    await act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(hex, '#ab3412');
      hex.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      hex.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    assert.ok(marks().some((mark: { type: string; attrs?: { tone: string } }) => mark.type === 'textColor' && mark.attrs?.tone === '#ab3412'));
    assert.match(editor.getHTML(), /data-notebook-text-color="#ab3412"/);
    await click(textButton('Clear formatting'));
    assert.deepEqual(marks(), []);
    assert.equal(editor.getText(), 'Assay result');
    await reset('<p><span style="color:#ff0000">ordinary</span> <span data-notebook-text-color="blue">blue</span> <span data-notebook-text-color="url(javascript:bad)">ignored</span></p>');
    const content = editor.getJSON().content[0].content;
    const byText = (text: string) => content.find((node: { text?: string }) => node.text?.trim() === text);
    assert.deepEqual(JSON.parse(JSON.stringify(byText('ordinary').marks)), [{ type: 'textColor', attrs: { tone: '#ff0000' } }]);
    assert.deepEqual(JSON.parse(JSON.stringify(byText('blue').marks)), [{ type: 'textColor', attrs: { tone: 'blue' } }]);
    assert.equal(byText('ignored').marks, undefined);
  });

  await t.test('all heading levels and block styles, including nested checklist indentation', async () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await reset();
      await select('Formatting', `heading-${level}`);
      assert.equal(editor.getJSON().content[0].attrs.level, level);
      await select('Formatting', 'paragraph');
      assert.equal(editor.getJSON().content[0].type, 'paragraph');
    }
    const blocks = { bulletList: 'Bullet list', orderedList: 'Numbered list', taskList: 'Checklist', blockquote: 'Quote', codeBlock: 'Code block' };
    for (const [kind, label] of Object.entries(blocks)) {
      await reset();
      if (kind === 'blockquote' || kind === 'codeBlock') await select('Formatting', kind);
      else await click(button(label));
      assert.equal(editor.getJSON().content[0].type, kind);
      await select('Formatting', 'paragraph');
      assert.equal(editor.getJSON().content[0].type, 'paragraph');
      assert.equal(editor.getText(), 'Assay result');
    }
    await reset('<p>First</p><p>Second</p>', { from: 6, to: 6 });
    await click(textButton('Divider'));
    assert.ok(editor.getJSON().content.some((node: { type: string }) => node.type === 'horizontalRule'));
    assert.equal(editor.getText().trim().split(/\s+/).join(' '), 'First Second');
    await reset('<p>First</p><p>Second</p>');
    await act(() => editor.commands.selectAll());
    await click(button('Bold'));
    assert.ok(editor.getJSON().content.every((node: any) => node.content[0].marks?.[0].type === 'bold'));
    await select('Formatting', 'heading-2');
    assert.ok(editor.getJSON().content.every((node: any) => node.type === 'heading' && node.attrs.level === 2));
    for (const [kind, label] of Object.entries({ bulletList: 'Bullet list', orderedList: 'Numbered list', taskList: 'Checklist' })) {
      await reset('<p>First</p><p>Second</p>', { from: 1, to: 13 });
      await click(button(label));
      assert.equal(editor.getJSON().content[0].type, kind);
      let start = 0;
      editor.state.doc.descendants((node: { isText: boolean; text?: string }, pos: number) => { if (node.isText && node.text === 'Second') start = pos; });
      await act(() => editor.commands.setTextSelection(start));
      assert.equal(button('Indent list item').disabled, false);
      await click(button('Indent list item'));
      assert.equal(editor.state.selection.$from.depth, 5);
      await click(button('Outdent list item'));
      assert.equal(editor.state.selection.$from.depth, 3);
      assert.equal(editor.state.doc.firstChild.childCount, 2);
    }
  });

  await t.test('link dialog retains selection, rejects unsafe input, edits and removes the link', async () => {
    for (const value of ['https://example.org/report?q=1', 'http://example.org', 'mailto:research@example.org']) assert.equal(isNotebookLinkUri(value), true);
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'ftp://example.org', '//example.org', 'https://', 'mailto:', 'https://example.org/\npath', 'https://example.org/' + 'x'.repeat(2048)]) assert.equal(isNotebookLinkUri(value), false);
    await reset();
    await click(button('Insert link'));
    assert.equal(document.activeElement?.tagName, 'INPUT');
    await fill('Link address', 'javascript:alert(1)');
    await submit();
    assert.ok(document.querySelector('dialog [role=alert]'));
    assert.deepEqual(marks(), []);
    await fill('Link address', 'https://example.org/report');
    await submit();
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(document.activeElement, editor.view.dom);
    assert.deepEqual(marks(), [{ type: 'link', attrs: { href: 'https://example.org/report', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }]);
    assert.deepEqual({ from: editor.state.selection.from, to: editor.state.selection.to }, { from: 1, to: 6 });
    await act(() => editor.commands.setTextSelection(3));
    await click(button('Edit link'));
    await fill('Link address', 'mailto:lab@example.org');
    await submit();
    assert.equal(marks()[0].attrs.href, 'mailto:lab@example.org');
    assert.equal(editor.state.selection.from, 3);
    await click(button('Edit link'));
    await click(textButton('Remove link'));
    assert.deepEqual(marks(), []);
    assert.equal(editor.getText(), 'Assay result');
    assert.equal(document.activeElement, editor.view.dom);
  });

  await t.test('paste canonicalizes link presentation and drops only unsafe marks, without changing JSON imports', async () => {
    const content = { type: 'paragraph', content: [
      { type: 'text', text: 'safe', marks: [
        { type: 'bold' },
        { type: 'link', attrs: { href: 'https://example.org/paper', target: '_self', rel: 'external', class: 'source-style', title: 'Source title' } },
      ] },
      { type: 'text', text: 'unsafe', marks: [
        { type: 'italic' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } },
      ] },
    ] };
    const input = ui.Slice.fromJSON(editor.schema, {
      content: [{ type: 'blockquote', content: [content] }], openStart: 2, openEnd: 2,
    });
    const before = JSON.stringify(input.toJSON());
    let pasted = input;
    editor.view.someProp('transformPasted', (transform: Function) => { pasted = transform(pasted, editor.view, false); });
    assert.equal(pasted.openStart, 2);
    assert.equal(pasted.openEnd, 2);
    assert.equal(pasted.content.firstChild.type.name, 'blockquote');
    const paragraph = pasted.content.firstChild.firstChild;
    assert.equal(paragraph.textContent, 'safeunsafe');
    assert.deepEqual(JSON.parse(JSON.stringify(paragraph.child(0).marks.map((mark: any) => mark.toJSON()))), [
      { type: 'link', attrs: { href: 'https://example.org/paper', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } },
      { type: 'bold' },
    ]);
    assert.deepEqual(paragraph.child(1).marks.map((mark: any) => mark.type.name), ['italic']);
    assert.equal(JSON.stringify(input.toJSON()), before);
    await reset();
    await act(() => editor.view.dispatch(editor.state.tr.replaceSelection(pasted)));
    assert.equal(editor.state.doc.textContent, 'safeunsafe result');
    let insertedLink: any;
    editor.state.doc.descendants((node: any) => { if (node.text === 'safe') insertedLink = node.marks.find((mark: any) => mark.type.name === 'link'); });
    assert.equal(insertedLink.attrs.target, '_blank');
    await act(() => editor.commands.setContent({ type: 'doc', content: [content] }));
    assert.equal(editor.getJSON().content[0].content[0].marks.find((mark: any) => mark.type === 'link').attrs.class, 'source-style');
  });

  await t.test('collapsed link insertion, cancel and symbol replacement return focus without leaking HTML', async () => {
    await reset('<p>Result:</p>', { from: 8, to: 8 });
    await click(button('Insert link'));
    await fill('Link address', 'https://example.org');
    await fill('Link text', '<sample>');
    await submit();
    assert.equal(editor.getText(), 'Result:<sample>');
    assert.match(editor.getHTML(), /&lt;sample&gt;/);
    assert.equal(editor.isActive('link'), false);
    await reset();
    await click(button('Insert link'));
    await fill('Link address', 'https://example.org/cancel');
    await act(() => document.querySelector('dialog')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('dialog'), null);
    assert.deepEqual(marks(), []);
    assert.equal(editor.state.selection.from, 1);
    assert.equal(editor.state.selection.to, 6);
    assert.equal(document.activeElement, editor.view.dom);
    await click(button('Insert symbol'));
    assert.equal(document.activeElement, button('Insert α (alpha)'));
    await click(button('Insert α (alpha)'));
    assert.equal(editor.getText(), 'α result');
    assert.equal(document.activeElement, editor.view.dom);
    await act(() => editor.setEditable(false));
    assert.equal(document.querySelector('#root')!.textContent, '');
  });
});
