import type { ScientificMethod } from './view.mjs';
import type { EnvironmentObservation, InspectionRecord } from './model.mjs';
export type InspectEnvironment = (target:ScientificMethod, options:{signal:AbortSignal})=>Promise<EnvironmentObservation>;
export function inspectEnvironment(target:ScientificMethod,options?:{signal?:AbortSignal;fetchFn?:typeof fetch}):Promise<EnvironmentObservation>;
export function createInspectionSession(options?:{inspect?:InspectEnvironment;changed?:(records:Record<string,InspectionRecord>)=>void}):{records:Record<string,InspectionRecord>;check(target:ScientificMethod):Promise<void>;dispose():void};
