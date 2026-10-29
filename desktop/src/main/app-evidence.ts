import type { AppScope, AppSurface } from './app-use-task.ts';

/** A durable receipt binds captured bytes to the grant and the panel that produced them. */
export type AppCaptureReceipt = Readonly<{
  schema: 'pero.app-capture.v1';
  id: string;
  role: 'app-capture';
  mediaType: 'image/png';
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  scope: AppScope;
  surfaceId: string;
  instance: string;
  rect: AppSurface['rect'];
  threadId: string;
  agentId: string;
  taskId: string;
  target?: string;
  capturedAt: string;
  path?: string;
}>;
