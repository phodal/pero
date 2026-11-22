declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string | RTCDataChannel | object);
    viewOnly: boolean;
    scaleViewport: boolean;
    sendCredentials(credentials: Partial<Record<'username' | 'password' | 'target', string>>): void;
    disconnect(): void;
  }
}
