export const MAX_DEVICE_BYTES: number;

export interface DeviceHandle {
  id: string;
  provider: 'browser' | 'desktop';
  mediaType: string;
  size: number;
  name: string;
}

export type DevicePick =
  | { outcome: 'selected'; handle: DeviceHandle }
  | { outcome: 'cancelled' | 'denied' | 'offline' };

export interface DeviceGesture {
  outcome?: 'selected' | 'cancelled' | 'denied' | 'offline';
  offline?: boolean;
  path?: string;
  absolutePath?: string;
  handle?: { id: string; mediaType: string; size: number; name: string };
}

export interface DeviceTransferPlan {
  uploadId: string;
  project: string;
  app: string;
  handleId: string;
  digest: string;
  size: number;
  mediaType: string;
}

export function interpretDevicePick(provider: 'browser' | 'desktop', gesture: DeviceGesture): DevicePick;
export function planDeviceTransfer(handle: DeviceHandle, target: { uploadId: string; project: string; app: string; digest: string }): DeviceTransferPlan;
export function createBrowserFileProvider(online?: () => boolean): { pick(gesture: DeviceGesture): DevicePick };
export function createDesktopFileProvider(): { pick(gesture: DeviceGesture): DevicePick };
