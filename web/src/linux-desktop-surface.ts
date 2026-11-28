import type { DesktopAction, DesktopSnapshot } from '../../desktop/src/preload/linux-desktop';
import type { SshVncProfile } from '../../desktop/src/main/ssh-desktop';

type Slot = {
  thread: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
};
export type LinuxDesktopHost = {
  linuxDesktopSurface(surface: { thread: string; visible: boolean } | null): Promise<string | undefined>;
  linuxDesktopAction(action: DesktopAction, value?: SshVncProfile): Promise<DesktopSnapshot>;
  onLinuxDesktop(callback: (state: DesktopSnapshot | null) => void): void;
};

export function mountLinuxDesktop(host: LinuxDesktopHost, title: string) {
  let frame: HTMLIFrameElement | undefined;
  let port: MessagePort | undefined;
  let next = 'null';
  let slot: Slot | null = null;
  let admission = 'null';
  let opening: Promise<string | undefined> | undefined;
  let scheduled = false;

  host.onLinuxDesktop(state => {
    if (state) {
      port?.postMessage({ state });
    } else {
      port?.close();
      port = undefined;
      frame?.remove();
      frame = undefined;
    }
  });

  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== new URL(frame.src).origin ||
        event.data !== 'pero-linux-desktop-ready') return;
    port?.close();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = ({ data }: MessageEvent<{ id: number; action: DesktopAction; value?: SshVncProfile }>) => {
      const { id, action, value } = data;
      void host.linuxDesktopAction(action, value).then(
        result => channel.port1.postMessage({ id, result }),
        error => channel.port1.postMessage({ id, error: String(error) }),
      );
    };
    frame.contentWindow?.postMessage('pero-linux-desktop', event.origin, [channel.port2]);
  });

  // Workbench clears the slot before its measured body publishes the new bounds.
  return (json: string) => {
    next = json;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      scheduled = false;
      slot = JSON.parse(next) as Slot | null;
      const selection = slot && { thread: slot.thread, visible: !!slot.bounds };
      const encoded = JSON.stringify(selection);
      if (admission !== encoded) {
        admission = encoded;
        opening = host.linuxDesktopSurface(selection).catch(error => {
          console.error(error);
          return undefined;
        });
      }
      if (frame) frame.hidden = !slot?.bounds;
      const url = await opening;
      const bounds = slot?.bounds;
      if (!url || !bounds) return;
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'pero-linux-desktop';
        frame.title = title;
        frame.sandbox.add('allow-scripts', 'allow-same-origin');
        frame.allow = 'clipboard-write';
        frame.src = url;
        document.body.append(frame);
      }
      frame.style.left = `${bounds.x}px`;
      frame.style.top = `${bounds.y}px`;
      frame.style.width = `${bounds.width}px`;
      frame.style.height = `${bounds.height}px`;
      const { x, y, width, height } = bounds;
      const left = `${x}px`, top = `${y}px`, right = `${x + width}px`, bottom = `${y + height}px`;
      document.documentElement.style.setProperty('--pero-linux-desktop-cutout',
        `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left} ${top}, ${right} ${top}, ${right} ${bottom}, ${left} ${bottom}, ${left} ${top})`);
      frame.hidden = false;
    });
  };
}
