import type {Skill, Installed} from './types';
export function skillCopy(skill:Skill): {revision:string;title:string;summary:string;input:string;output:string;example:string} | undefined;
export function installationBlock(skill: Skill): '' | 'internal' | 'repository' | 'license' | 'archive';
export function findSkills(skills: Skill[], options?: {query?: string; category?: string; view?: string; installed?: Installed[]; page?: number; onlyReady?: boolean; sort?: string}): {items: Skill[]; total: number; page: number; pages: number};
