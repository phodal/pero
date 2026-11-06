import type { ScientificMethod } from './view.mjs';
export interface Method { readonly id: ScientificMethod; readonly name: string; readonly app: string; readonly software: string; readonly icon: string; readonly tone: 'neutral' | 'blue' | 'apricot' }
export const METHODS: readonly Method[];
export const METHOD_IDS: readonly ScientificMethod[];
export const OBSERVATION_MAX_AGE_MS: number;
export type Requirement = {kind:'profile';digest:string} | {kind:'python';major:number;minor:number;patch:number|null} | {kind:'package';name:string;version:string|null} | {kind:'native';name:string;sha256:string|null} | {kind:'platform';system:string;machine:string};
export interface EnvironmentObservation {
 schema:string;method:ScientificMethod;scope:'configured-interpreter';evidence:'metadata_only';observed_at_ms:number;matched:boolean;missing:Requirement[];
 profile:{id:string;observation:{name:string;python:{major:number;minor:number;patch:number};system:string;machine:string;interpreter_sha256:string|null;packages:Record<string,string|null>;native:Record<string,{status:'observed'|'missing'|'probe_failed'|'unsupported';version:string|null;sha256:string|null}>}};
 requirements:{method:ScientificMethod;required:Requirement[];preferred:Requirement[]};
}
export interface InspectionRecord { state:'loading'|'observed'|'error';report?:EnvironmentObservation;error?:string }
export function readInspection(value:unknown,expectedMethod:ScientificMethod):EnvironmentObservation;
export function observationState(report:EnvironmentObservation|undefined|null,now:number):'unchecked'|'stale'|'matched'|'blocked';
export function requirementText(rule:Requirement):string;
export function filterMethods(targets:readonly ScientificMethod[],query:string,filter:string,records:Record<string,InspectionRecord>,now:number):Method[];
