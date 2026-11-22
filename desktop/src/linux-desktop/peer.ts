import RFB from '@novnc/novnc';
import '@pero/app-sdk/tokens.css';
import './peer.css';
import { connectPair } from './paired-transport.ts';

const status = document.querySelector('#status')!;
const screen = document.querySelector<HTMLElement>('#screen')!;
const match = /^#([\w-]{43})\.([\w-]{43})$/.exec(location.hash);
if (match) {
  history.replaceState(null, '', location.pathname);
  const connect = connectPair({ origin: location.origin, id: match[1], ticket: match[2] }, 'viewer', (channel, mode, viewOnly) => {
    const vnc = new RFB(screen, channel);
    vnc.viewOnly = viewOnly;
    vnc.scaleViewport = true;
    vnc.addEventListener('connect', () => {
      status.textContent = `${viewOnly ? 'Viewing only' : 'You have control'} · ${mode === 'webrtc' ? 'WebRTC' : 'Relay'}`;
    });
    vnc.addEventListener('credentialsrequired', () => {
      status.textContent = 'Password-protected VNC needs to be opened in the Pero workbench.';
      connect();
    });
    vnc.addEventListener('disconnect', connect);
  }, () => { status.textContent = 'The shared desktop disconnected. Ask the owner for a new link.'; });
} else {
  status.textContent = 'Open a pairing link from the Pero workbench.';
}
