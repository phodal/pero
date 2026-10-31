import tools from './tools.json' with { type: 'json' };

// Names sampled from tools/list on the installed, unmodified 0.1.60 servers.
// No vendor implementation, account configuration or credentials are included.
export const scienceVersion = '0.1.60-release';
export const scienceSpecs = [
  ['genomes', 'Genomes', 'Ensembl、VEP、UCSC', 'Ensembl, VEP, UCSC', 'protein'],
  ['genes_ontologies', 'Genes & Ontologies', 'MyGene、UniProt、GO、Reactome、OLS', 'MyGene, UniProt, GO, Reactome, OLS', 'protein'],
  ['variants', 'Variants', 'gnomAD、ClinVar、dbSNP', 'gnomAD, ClinVar, dbSNP', 'protein'],
  ['human_genetics', 'Human Genetics', 'GWAS Catalog、FinnGen、BioBank Japan', 'GWAS Catalog, FinnGen, BioBank Japan', 'protein'],
  ['clinical_genomics', 'Clinical Genomics', 'ClinGen、CIViC、Open Targets', 'ClinGen, CIViC, Open Targets', 'target'],
  ['expression', 'Expression', 'GTEx 表达与 eQTL', 'GTEx expression and eQTL', 'signal'],
  ['regulation', 'Regulation', 'JASPAR、UniBind', 'JASPAR, UniBind', 'protein'],
  ['protein_annotation', 'Protein Annotation', 'InterPro、Pfam、Human Protein Atlas、STRING', 'InterPro, Pfam, Human Protein Atlas, STRING', 'protein'],
  ['structures_interactions', 'Structures & Interactions', 'PDB、AlphaFold、EMDB、Complex Portal、IntAct', 'PDB, AlphaFold, EMDB, Complex Portal, IntAct', 'cad'],
  ['rna', 'RNA', 'Rfam RNA 家族', 'Rfam RNA families', 'protein'],
  ['omics_archives', 'Omics Archives', 'GEO、ArrayExpress、PRIDE、MGnify、MetaboLights', 'GEO, ArrayExpress, PRIDE, MGnify, MetaboLights', 'bom'],
  ['cancer_models', 'Cancer Models', 'cBioPortal 癌症研究', 'cBioPortal cancer studies', 'target'],
  ['chemistry', 'Chemistry', 'PubChem、ChEBI、Rhea、BindingDB', 'PubChem, ChEBI, Rhea, BindingDB', 'simulation'],
  ['drug_regulatory', 'Drug Regulatory', 'FDA 药品数据、openFDA', 'FDA drug data, openFDA', 'evidence'],
  ['literature', 'Literature Graph', 'OpenAlex、arXiv 文献图谱', 'OpenAlex, arXiv literature graph', 'notebook'],
  ['research_resources', 'Research Resources', 'Grants.gov、Antibody Registry', 'Grants.gov, Antibody Registry', 'evidence'],
  ['biomart', 'BioMart', 'Ensembl BioMart 数据集', 'Ensembl BioMart datasets', 'bom'],
  ['cellguide', 'CellGuide', 'CELLxGENE 细胞参考', 'CELLxGENE cell references', 'protein'],
  ['zinc', 'ZINC', 'ZINC 化合物', 'ZINC compounds', 'simulation'],
  ['pubmed', 'PubMed', 'PubMed 文献', 'PubMed literature', 'notebook'],
  ['clinical_trials', 'Clinical Trials', 'ClinicalTrials.gov 试验记录', 'ClinicalTrials.gov trial records', 'evidence'],
  ['chembl', 'ChEMBL', 'ChEMBL 活性与靶点', 'ChEMBL bioactivity and targets', 'target'],
  ['biorxiv', 'bioRxiv', 'bioRxiv、medRxiv 预印本', 'bioRxiv, medRxiv preprints', 'notebook'],
  ['ketcher', 'Ketcher Chemistry', '分子草图 MCP App', 'Molecular sketcher MCP App', 'simulation'],
].map(([domain, displayName, summary, summaryEn, iconId]) => ({ domain, providerId: `science-${domain.replaceAll('_', '-')}`, displayName, summary, summaryEn, iconId, tools: tools[domain] }));

export function scienceProviderId(definition) {
  const args = definition?.args;
  if (!Array.isArray(args) || !/(?:^|\/)point-science-connector\.mjs$/.test(args[0] ?? '') || args.length !== 3 || args[1] !== '--domain') return null;
  return scienceSpecs.find(spec => spec.domain === args[2])?.providerId ?? null;
}
