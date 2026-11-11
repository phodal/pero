import type { MystProjectProjection } from './myst-project.ts';
import { renderMystHtml, renderMystHtmlShell, escapeMystHtml } from './myst-render.ts';
import { renderIpynbHtml } from './ipynb-render.ts';
import type { MystProjectTocEntry } from './myst-toc.ts';
import { mystAnchor } from './myst-project-references.ts';
/** Every internal destination is present in this one self-contained document. */
export function renderMystProjectHtml(project: MystProjectProjection): string {
  const renderNavigation = (entries: readonly MystProjectTocEntry[]): string => `<ul>${entries.filter(item => !item.hidden).map(item => `<li>${item.path ? `<a href="#${mystAnchor('', item.path)}">${escapeMystHtml(item.title)}</a>` : escapeMystHtml(item.title)}${item.children.some(child => !child.hidden) ? renderNavigation(item.children) : ''}</li>`).join('')}</ul>`;
  const navigation = `<nav aria-label="Project pages">${renderNavigation(project.toc)}</nav>`;
  const publications = new Map(project.pages.map(page => [page.path, renderMystHtml(page.document, { namespace: page.path, fragment: true })]));
  for (const page of project.notebookPages) {
    const body=page.kind==='ipynb'?renderIpynbHtml(page.document,{namespace:page.path,fragment:true,scholarly:page.scholarly,citationRendering:page.citationRendering,markdown:new Map(page.markdownCells.map(cell=>[cell.index,cell.document])),code:new Map(page.codeCells.map(cell=>[cell.index,cell.document]))}):`<p>Notebook source cannot be compiled: ${page.diagnostics.map(item=>escapeMystHtml(item.message)).join('; ')}</p><pre>${escapeMystHtml(page.source)}</pre>`;
    publications.set(page.path, `<section id="${mystAnchor('',page.path)}">${body}</section>`);
  }
  const title=project.entry.kind==='myst'?project.entry.document.scholarly.title:project.entry.kind==='ipynb'?project.entry.scholarly.title:undefined;
  return renderMystHtmlShell(title??project.entry.path,`${navigation}${project.pageOrder.map(path => publications.get(path) ?? '').join('\n')}`);
}
