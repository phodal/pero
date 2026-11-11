import type { MystCitationRendering } from './myst.ts';
import { escapeMystHtml } from './myst-render.ts';
import { mystAnchor } from './myst-project-references.ts';

/** One ordered bibliography for a Markdown document or an entire notebook. */
export function renderMystCitationBibliography(rendering: MystCitationRendering, namespace?: string): string {
  const items = rendering.bibliography.map(entry => `<li id="${escapeMystHtml(mystAnchor(`citation-${entry.id}`, namespace))}">${entry.html}</li>`).join('');
  return items ? `<section aria-label="References"><h2>References</h2><p class="notice">${escapeMystHtml(rendering.style.title)} · ${escapeMystHtml(rendering.locale)} · ${rendering.engine}. Authored metadata; not externally verified.</p><ul>${items}</ul></section>` : '';
}
