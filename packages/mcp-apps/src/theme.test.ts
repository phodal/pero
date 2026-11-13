import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import type {McpUiHostContext, McpUiStyles} from '@modelcontextprotocol/ext-apps';
import {applyMcpAppTheme, mcpAppHostContext} from './theme.ts';

test('MCP theme roles preserve shared-control defaults and partial updates', async t => {
  for (const theme of ['light', 'dark'] as const) {
    await t.test(theme, () => {
      const source = new JSDOM('<!doctype html><html><head></head><body></body></html>');
      const view = new JSDOM('<!doctype html><html><head></head><body></body></html>');
      try {
        const root = source.window.document.documentElement;
        root.style.setProperty('--pero-surface', theme === 'dark' ? '#101820' : '#ffffff');
        root.style.setProperty('--pero-text', theme === 'dark' ? '#e0e8f0' : '#172536');
        root.style.setProperty('--pero-text-muted', '#778899');
        root.style.setProperty('--pero-input-border', '#8899aa');
        root.style.setProperty('--pero-border', '#aabbcc');
        root.style.setProperty('--pero-font-body', '17px');
        root.style.setProperty('--pero-action', '#007f86');
        const context = mcpAppHostContext({theme, locale: 'zh-CN', styles: {
          variables: {'--color-text-secondary': '#667788'} as McpUiStyles,
        }}, root);
        const target = view.window.document.documentElement;
        target.style.setProperty('--pero-action', '#9855bb');
        target.style.setProperty('--pero-success', '#00aa55');
        applyMcpAppTheme(context, view.window.document);

        assert.equal(target.dataset.theme, theme);
        assert.equal(target.style.colorScheme, theme);
        assert.equal(target.lang, 'zh-CN');
        assert.equal(target.style.getPropertyValue('--pero-surface'), theme === 'dark' ? '#101820' : '#ffffff');
        assert.equal(target.style.getPropertyValue('--pero-text-muted'), '#667788');
        assert.equal(target.style.getPropertyValue('--pero-font-body'), '17px');
        assert.equal(target.style.getPropertyValue('--pero-input-border'), '#8899aa');
        assert.equal(target.style.getPropertyValue('--pero-border'), '#aabbcc');
        // The standard has no action role; neither it nor absent status roles
        // may overwrite the existing component library's own defaults.
        assert.equal(target.style.getPropertyValue('--pero-action'), '#9855bb');
        assert.equal(target.style.getPropertyValue('--pero-success'), '#00aa55');

        applyMcpAppTheme({locale: 'en-GB'}, view.window.document);
        assert.equal(target.dataset.theme, theme);
        assert.equal(target.style.getPropertyValue('--pero-text-muted'), '#667788');
        assert.equal(target.lang, 'en-GB');
        applyMcpAppTheme({theme: theme === 'dark' ? 'light' : 'dark'}, view.window.document);
        assert.equal(target.style.colorScheme, theme === 'dark' ? 'light' : 'dark');
        assert.equal(target.lang, 'en-GB');
      } finally {
        source.window.close();
        view.window.close();
      }
    });
  }
});

test('View font CSS applies and clears in its own document', () => {
  const view = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  try {
    const defaultFont = view.window.getComputedStyle(view.window.document.documentElement).fontFamily;
    const context: McpUiHostContext = {styles: {css: {fonts: 'html{font-family:Example}'}}};
    applyMcpAppTheme(context, view.window.document);
    assert.equal(view.window.getComputedStyle(view.window.document.documentElement).fontFamily, 'Example');
    applyMcpAppTheme({styles: {css: {fonts: ''}}}, view.window.document);
    assert.equal(view.window.getComputedStyle(view.window.document.documentElement).fontFamily, defaultFont);
  } finally {
    view.window.close();
  }
});
