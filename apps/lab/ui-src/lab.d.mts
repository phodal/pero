export type Bridge = {
  get(path: string): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
  ask(text: string): void | Promise<unknown>;
};
export function mountLab(root: HTMLElement, bridge: Bridge): {refresh(): Promise<void>; destroy(): void};
export function comparableDelta(trial: any, parent: any): number | null;
