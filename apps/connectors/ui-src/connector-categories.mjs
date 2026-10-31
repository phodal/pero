// Presentation taxonomy only: provider IDs and runtime categories stay stable.
//
// The catalog has exactly one level: each shelf is both a filter tab and a
// section heading, so there is no second tier of sub-headings to reconcile
// with the tabs. Shelves are sized by what a person is looking for (a CAD
// tool, a literature tool), not by the broad runtime category.
//
// Runtime categories `custom` (remote-oauth, remote-token, local-process —
// transport templates reached through 添加自定义 MCP), `builtin` (sealed) and
// `messaging` (channels, managed on their own page) have no shelf; they still
// resolve for installed connections.
export const CONNECTOR_SHELVES = [
  { id: 'work', zh: '研发与协作', en: 'Development & collaboration', providers: ['github', 'gitlab', 'linear', 'microsoft-365', 'notion', 'vercel'] },
  { id: 'simulation', zh: '仿真与计算', en: 'Simulation & computation', providers: ['matlab', 'simulink', 'ansys-aedt', 'ansys-fluent', 'ansys-mapdl', 'ansys-mechanical', 'comsol', 'fmu-runtime'] },
  { id: 'design', zh: '设计与建模', en: 'Design & modeling', providers: ['freecad', 'kicad', 'onshape', 'autodesk-fusion'] },
  { id: 'equipment', zh: '测试、设备与制造', en: 'Testing, equipment & manufacturing', providers: ['nominal', 'pyvisa', 'foxglove', 'opc-ua', 'highbyte', 'carbon', 'openbom'] },
  { id: 'life-sciences', zh: '生命科学', en: 'Life sciences', providers: ['benchling', 'biocontext', 'biomcp', 'open-targets', 'galaxy', 'seqera', 'synapse', 'cyanheads-clinicaltrialsgov', 'cyanheads-uniprot', 'cyanheads-chembl', 'cyanheads-pubchem', 'cyanheads-ensembl', 'cyanheads-brapi', 'cyanheads-gbif-biodiversity', 'cyanheads-paleobiology', 'cyanheads-openfda', 'cyanheads-cdc-health'] },
  { id: 'lab', zh: '实验室与数据管理', en: 'Lab & data management', providers: ['elabftw', 'labkey', 'pylabrobot', 'quilt'] },
  { id: 'computing', zh: '科学计算与机器学习', en: 'Scientific computing & ML', providers: ['jupyter', 'r-mcptools', 'wolfram', 'wandb', 'mlflow'] },
  { id: 'literature', zh: '文献与科研写作', en: 'Literature & publishing', providers: ['zotero', 'scite', 'wiley', 'biorender', 'cyanheads-pubmed', 'cyanheads-arxiv', 'cyanheads-biorxiv', 'cyanheads-orcid', 'cyanheads-crossref', 'cyanheads-datacite', 'cyanheads-openalex', 'cyanheads-zenodo', 'cyanheads-cern-inspire'] },
];

// A provider added to the catalog before it is placed on a shelf stays
// visible on the shelf closest to its runtime category.
const FALLBACK_SHELF = {
  'developer-tools': 'work', 'collaboration-docs': 'work', productivity: 'work',
  engineering: 'simulation', research: 'computing',
};

const SHELF_OF = new Map(CONNECTOR_SHELVES.flatMap(shelf => shelf.providers.map(id => [id, shelf.id])));

/** The shelf an entry is listed on, or null when it has no catalog shelf. */
export function connectorShelf(entry) {
  return SHELF_OF.get(entry.providerId) ?? FALLBACK_SHELF[entry.category] ?? null;
}

export function connectorShelfLabels(locale = 'zh') {
  return Object.fromEntries(CONNECTOR_SHELVES.map(shelf => [shelf.id, shelf[locale === 'zh' ? 'zh' : 'en']]));
}

/** Non-empty shelves in tab order, each with its entries in directory order. */
export function connectorSections(entries, locale = 'zh') {
  const labels = connectorShelfLabels(locale);
  return CONNECTOR_SHELVES
    .map(shelf => ({ id: shelf.id, label: labels[shelf.id], entries: entries.filter(entry => connectorShelf(entry) === shelf.id) }))
    .filter(section => section.entries.length > 0);
}
