export type ScientificMethod = 'paper-agent.pcgym' | 'control-lab.python-control' | 'control-lab.ngspice';
export interface EnvironmentViewOptions {
  targets?: readonly ScientificMethod[];
  locale?: string;
  selected?: ScientificMethod;
  single?: boolean;
  autoInspect?: boolean;
}
export function mountEnvironmentView(root: HTMLElement, options?: EnvironmentViewOptions): { setLocale(locale: string): void; dispose(): void };
export function mountEnvironmentInspector(root: HTMLElement, options?: EnvironmentViewOptions): { dispose(): void };
