import type { MystProjectProjection } from './myst-project.ts';
import { renderMystHtml, renderMystHtmlShell, escapeMystHtml } from './myst-render.ts';
import { mystAnchor } from './myst-project-references.ts';
/** All internal destinations occur in this one self-contained inert document. */
export function renderMystProjectHtml(project: MystProjectProjection): string {
  const navigation = `<nav aria-label="Project pages"><ul>${project.pages.map(page => `<li><a href="#${mystAnchor('', page.path)}">${escapeMystHtml(page.document.scholarly.title ?? page.path)}</a></li>`).join('')}</ul></nav>`;
  const pages = project.pages.map(page => renderMystHtml(page.document, { namespace: page.path, fragment: true })).join('\n');
  return renderMystHtmlShell(project.entry.scholarly.title ?? 'MyST project', `${navigation}${pages}`);
}
