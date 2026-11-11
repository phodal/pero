import type { MystProjectProjection } from './myst-project.ts';
import { renderMystHtml, renderMystHtmlShell, escapeMystHtml } from './myst-render.ts';
import { renderIpynbHtml } from './ipynb-render.ts';
import { mystAnchor } from './myst-project-references.ts';
/** Every internal destination is present in this one self-contained document. */
export function renderMystProjectHtml(project: MystProjectProjection): string {
  const destinations=[...project.pages.map(page=>({path:page.path,title:page.document.scholarly.title??page.path})),...project.notebookPages.map(page=>({path:page.path,title:page.kind==='ipynb'?page.scholarly.title??page.path:page.path}))];
  const navigation=`<nav aria-label="Project pages"><ul>${destinations.map(page=>`<li><a href="#${mystAnchor('',page.path)}">${escapeMystHtml(page.title)}</a></li>`).join('')}</ul></nav>`;
  const pages=project.pages.map(page=>renderMystHtml(page.document,{namespace:page.path,fragment:true})).join('\n');
  const notebooks=project.notebookPages.map(page=>{
    const body=page.kind==='ipynb'?renderIpynbHtml(page.document,{namespace:page.path,fragment:true,scholarly:page.scholarly,citationRendering:page.citationRendering,markdown:new Map(page.markdownCells.map(cell=>[cell.index,cell.document]))}):`<p>Notebook source cannot be compiled: ${page.diagnostics.map(item=>escapeMystHtml(item.message)).join('; ')}</p><pre>${escapeMystHtml(page.source)}</pre>`;
    return `<section id="${mystAnchor('',page.path)}">${body}</section>`;
  }).join('\n');
  const title=project.entry.kind==='myst'?project.entry.document.scholarly.title:project.entry.kind==='ipynb'?project.entry.scholarly.title:undefined;
  return renderMystHtmlShell(title??project.entry.path,`${navigation}${pages}${notebooks}`);
}
