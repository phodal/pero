import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('sidebar collapse preserves names, navigation and group boundaries', async t => {
  const { React, ui, render, click } = await createUiRuntime(t, {
    resolveDir: resolve(import.meta.dirname, '../../pero-design/src'),
    contents: "export { Sidebar, SidebarGroup } from './shell'; export { SidebarRow } from './components'; export { default as shellCss } from './shell.css'; export { default as componentCss } from './components.css';",
    cssText: true,
  });
  const style = document.createElement('style');
  style.textContent = ui.componentCss + ui.shellCss;
  document.head.append(style);
  const h = React.createElement;
  const calls = [];
  const tree = collapsed => h(ui.Sidebar, { label: 'Main navigation', collapsed },
    h(ui.SidebarGroup, { label: 'Research', separated: true },
      h(ui.SidebarRow, { label: 'Papers', count: 3, lead: h('svg'), selected: true, onClick: () => calls.push('papers') }),
      h(ui.SidebarRow, { label: h('strong', null, 'Projects'), lead: h('svg'), onClick: () => calls.push('projects') }),
      h(ui.SidebarRow, { label: 'Unavailable', lead: h('svg'), disabled: true, onClick: () => calls.push('disabled') }),
      h(ui.SidebarRow, { label: 'Text fallback' }),
      ...[false, '', null, undefined, []].map((lead, index) => h(ui.SidebarRow, { key: index, label: `Empty lead ${index}`, lead }))),
    h(ui.SidebarGroup, null, h(ui.SidebarRow, { label: 'Settings', lead: h('svg'), 'aria-label': 'Application settings', title: 'Open settings' })));

  for (const collapsed of [false, true, false]) {
    await render(tree(collapsed));
    const nav = document.querySelector('nav');
    const group = nav.querySelector('[role="group"]');
    const [papers, projects, disabled, fallback, ...remaining] = nav.querySelectorAll('button');
    const settings = remaining.at(-1);
    const label = papers.querySelector('.pero-sidebar-label');
    assert.equal(nav.getAttribute('aria-label'), 'Main navigation');
    assert.equal(group.getAttribute('aria-label'), 'Research');
    assert.equal(group.hasAttribute('data-separated'), true);
    assert.equal(nav.querySelectorAll('[role="group"]').length, 1);
    assert.equal(getComputedStyle(group.querySelector('.pero-sidebar-group-label')).display === 'none', collapsed);
    assert.equal(getComputedStyle(papers.querySelector('.pero-sidebar-count')).display === 'none', collapsed);
    assert.equal(getComputedStyle(label).position === 'absolute', collapsed);
    assert.notEqual(getComputedStyle(projects.querySelector('.pero-sidebar-label')).display, 'none');
    assert.equal(projects.querySelector('.pero-sidebar-label').textContent, 'Projects');
    assert.equal(projects.querySelector('.pero-lead').getAttribute('aria-hidden'), 'true');
    assert.equal(papers.getAttribute('aria-label'), 'Papers');
    assert.equal(papers.title, 'Papers');
    assert.equal(papers.getAttribute('aria-current'), 'page');
    assert.equal(settings.getAttribute('aria-label'), 'Application settings');
    assert.equal(settings.title, 'Open settings');
    assert.notEqual(getComputedStyle(fallback.querySelector('.pero-sidebar-label')).position, 'absolute');
    for (const row of remaining.slice(0, -1)) {
      assert.equal(row.hasAttribute('data-has-lead'), false);
      assert.notEqual(getComputedStyle(row.querySelector('.pero-sidebar-label')).position, 'absolute');
      assert.notEqual(getComputedStyle(row.querySelector('.pero-sidebar-label')).display, 'none');
    }
    papers.focus();
    assert.equal(document.activeElement, papers);
    await click(papers);
    await click(projects);
    await click(disabled);
  }
  assert.deepEqual(calls, ['papers', 'projects', 'papers', 'projects', 'papers', 'projects']);
});
