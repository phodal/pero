import type { DocumentExportFormat, DocumentImportFormat } from './scientific-block.ts';
import { importMystProjectSnapshot, exportMystProjectSnapshot, MYST_PROJECT_WIRE_MAX_BYTES } from './myst-project-snapshot.ts';
import { compileMystProject, type MystProjectProjection } from './myst-project.ts';
import { compileMystProjectCitations } from './myst-project-citations.ts';
import { renderMystProjectHtml } from './myst-project-render.ts';

export const mystProjectImportFormats: readonly DocumentImportFormat<{ schemaVersion: 1; snapshot: string }>[] = [{
  id: 'project', label: 'MyST text project', extensions: ['.myst-project.json'], mediaType: 'application/json',
  maxBytes: MYST_PROJECT_WIRE_MAX_BYTES,
  parse: text => ({ schemaVersion: 1, snapshot: exportMystProjectSnapshot(importMystProjectSnapshot(text)) }),
}];
export const mystProjectExportFormats: readonly DocumentExportFormat<{ snapshot: string; projection?: MystProjectProjection }, string | Promise<string>>[] = [
  { id: 'snapshot', label: 'MyST project snapshot', extensions: ['.myst-project.json'], mediaType: 'application/json', serialize: value => value.snapshot },
  { id: 'html', label: 'Project HTML publication', extensions: ['.html'], mediaType: 'text/html', serialize: async value => {
    if (value.projection) return renderMystProjectHtml(value.projection);
    const snapshot = importMystProjectSnapshot(value.snapshot);
    return renderMystProjectHtml(await compileMystProjectCitations(snapshot, compileMystProject(snapshot)));
  } },
];
