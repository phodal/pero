export type ConnectorReply = { ok: boolean; code?: string; [key: string]: unknown };
export type ConnectorSecrets = {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
export class HostConnectors {
  constructor(options: {
    root: string; executable: string; store: ConnectorSecrets;
    authorize(): Promise<void>; openURL(url: string): Promise<void>;
    nodeExecutable?: string; helpers?: string;
  });
  start(): Promise<void>;
  request(input: Record<string, unknown>): Promise<ConnectorReply>;
  tools(thread: string): Promise<{ connectorId: string; tools: string[]; transport: string }[]>;
  call(thread: string, connectorId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  forget(thread: string): Promise<void>;
  close(): Promise<void>;
}
