declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string);
    viewOnly: boolean;
    scaleViewport: boolean;
    disconnect(): void;
  }
}
