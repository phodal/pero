import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const stylesPath = fileURLToPath(new URL('../ui-src/styles.css', import.meta.url));

function rules(css: string) {
  const { window } = new JSDOM(`<style>${css}</style>`, { pretendToBeVisual: true });
  return [...window.document.styleSheets[0].cssRules];
}

function styleRules(ruleList: { type: number; selectorText?: string; style?: CSSStyleDeclaration; cssRules?: { type: number; selectorText?: string; style?: CSSStyleDeclaration }[] }[]) {
  return ruleList.filter(rule => rule.type === 1);
}

function declarations(ruleList: { type: number; selectorText?: string; style?: CSSStyleDeclaration }[], selector: string) {
  const found = new Map<string, string>();
  for (const rule of styleRules(ruleList)) {
    if (!rule.selectorText?.split(',').some(part => part.trim() === selector) || !rule.style) continue;
    for (const property of rule.style) found.set(property, rule.style.getPropertyValue(property).trim());
  }
  return found;
}

test('narrow notebook chrome stays one row without hiding the title or more tools', async () => {
  const css = await readFile(stylesPath, 'utf8');
  const sheet = rules(css);
  const narrow = sheet.find(rule => rule.type === 4 && rule.conditionText.replaceAll(' ', '') === '(max-width:760px)');
  assert.ok(narrow, 'widths through 760px compact the document chrome');
  const compact = [...narrow.cssRules];

  const toolbar = declarations(compact, '.notebook-toolbar.pero-ui-toolbar:not([data-unstyled])');
  assert.equal(toolbar.get('flex-wrap'), 'nowrap');
  assert.equal(toolbar.get('overflow-x'), 'auto');
  assert.equal(toolbar.get('padding-top'), '0px');
  const actionStatus = declarations(compact, '.notebook-action-status');
  assert.equal(actionStatus.get('flex-direction'), 'row');
  assert.equal(actionStatus.get('flex-wrap'), 'nowrap');
  assert.equal(actionStatus.get('overflow-x'), 'auto');
  assert.equal(declarations(compact, '.notebook-action-status > .notebook-notes-utilities').get('width'), 'auto');
  assert.equal(declarations(compact, '.notebook-document-actions.pero-ui-disclosure:not([data-unstyled])').get('padding-top'), '0px');
  assert.equal(declarations(compact, '.notebook-document-header').get('display'), 'flex');
  assert.equal(declarations(compact, '.notebook-document-header > .notebook-title').get('padding-block'), '0px');
  const toolbars = declarations(compact, '.notebook-editor-toolbars');
  assert.equal(toolbars.get('flex-wrap'), 'nowrap');
  assert.equal(toolbars.get('overflow-x'), 'auto');
  assert.equal(declarations(compact, '.notebook-editor-toolbars > .notebook-toolbar.pero-ui-toolbar:not([data-unstyled])').get('width'), 'max-content');
  assert.equal(declarations(compact, '.notebook-paper').get('margin-top'), 'var(--pero-spacing-1)');
  assert.equal(toolbar.get('width'), '100%');
  assert.equal(toolbar.get('max-width'), '100%');
  assert.equal(toolbar.get('box-sizing'), 'border-box');
  assert.equal(toolbar.get('contain'), 'paint');
  assert.equal(declarations(compact, '.notebook-document').get('min-width'), '0px');
  assert.equal(declarations(compact, '.notebook-document').get('max-width'), '100%');
  assert.equal(declarations(compact, '.notebook-sticky-header').get('min-width'), '0px');
  assert.equal(declarations(compact, '.notebook-workspace-navigation').get('width'), '100%');
  assert.equal(declarations(compact, '.notebook-notes-utilities').get('flex-wrap'), 'nowrap');
  assert.equal(declarations(compact, '.notebook-document-controls').get('flex-wrap'), 'nowrap');
  assert.equal(declarations(compact, '.notebook-toolbar .pero-ui-button').get('white-space'), 'nowrap');
  assert.equal(declarations(compact, '.notebook-toolbar-secondary').get('padding-top'), '0px');
  assert.equal(declarations(sheet, '.notebook-toolbar').get('flex-wrap'), 'wrap');
  assert.equal(declarations(sheet, '.notebook-toolbar-secondary').get('padding-top'), 'var(--pero-spacing-1)');

  for (const rule of styleRules(compact)) {
    assert.equal(rule.style?.display === 'none' && /\.notebook-title|(^|,)\s*h1\b/.test(rule.selectorText ?? ''), false, rule.selectorText);
  }
  assert.equal(declarations(compact, '.notebook-title').size, 0);
});
