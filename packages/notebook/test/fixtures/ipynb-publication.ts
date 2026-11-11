import { readFileSync } from 'node:fs';
import { compileMystProject } from '../../src/myst-project.ts';
import { parseMystProjectSnapshot } from '../../src/myst-project-snapshot.ts';
import { compiledMystEntryPublication } from '../../src/ipynb-publication.ts';
export const png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGPkEpFjYGBgYmBgQFAABLQAQr8+USQAAAAASUVORK5CYII=';
export function notebookPublicationFixture() {
  const raw=JSON.parse(readFileSync(new URL('./ipynb-contract.json',import.meta.url),'utf8'));
  raw.metadata.title='Notebook publication 界'; raw.cells[0].source='![one](attachment:photo)\n\n![two](attachment:photo)\n\n![three](attachment:photo)';
  raw.cells[0].attachments.photo={'image/png':png};raw.cells[1].metadata['pero.outputsStale']=true;
  raw.cells.push({id:'removed',cell_type:'raw',metadata:{tags:['remove-cell']},source:'REMOVED_BODY_SECRET'});
  const source=JSON.stringify(raw);
  const snapshot=parseMystProjectSnapshot({format:'pero-myst-project',version:1,entry:'study.ipynb',files:[{path:'study.ipynb',text:source}]});
  const entry=compileMystProject(snapshot).entry;
  return {source,entry,input:compiledMystEntryPublication(entry)};
}
