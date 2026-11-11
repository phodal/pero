export type Source = {repository: string; commit: string; path: string; url: string; sha256?: string};
export type EvidenceSection = {heading: string; text: string};
export type Skill = {
  id: string; name: string; title_zh: string; description: string; description_zh: string;
  category: string; category_zh: string; kind: 'general_skill' | 'research_skill' | 'research_support' | 'internal_dependency';
  installation?: {allowed: boolean; reason: string}; discovery_scopes?: string[];
  source: Source; sources: Source[];
  license: {spdx: string | null; evidence_url?: string | null; status: string};
  compatibility: {declared: string[]; status: string}; dependencies?: EvidenceSection[];
  inputs?: EvidenceSection[]; outputs?: EvidenceSection[]; examples?: EvidenceSection[];
  verification: {content: string; runtime: string; notes: string[]};
};
export type Catalog = {schema_version: number; generated_at: string; issue_url: string; sources: unknown[]; skills: Skill[]; resources: unknown[]; exclusions: unknown[]; stats: Record<string, unknown>};
export type Installed = {id: string; revision: string; enabled: boolean; selected: boolean; invocation?: string; previousRevision?: string; entry?: Skill};
export type Installations = {items: Installed[]; supportedAgent: string};
export type Update = {id: string; currentRevision: string; latestRevision: string; latestSha256: string; updateAvailable: boolean};
