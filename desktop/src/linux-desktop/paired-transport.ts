export type Pair = { origin: string; id: string; ticket: string };
export type RfbChannel = RTCDataChannel | RelayChannel;
type Mode = 'webrtc' | 'relay';

/** noVNC sees a binary-only channel even when signaling shares the WebSocket. */
class RelayChannel {
  binaryType = 'arraybuffer';
  protocol = '';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(private socket: WebSocket) {
    socket.addEventListener('message', event => { if (event.data instanceof ArrayBuffer) this.onmessage?.(event); });
    socket.addEventListener('close', event => this.onclose?.(event));
    socket.addEventListener('error', event => this.onerror?.(event));
  }

  get readyState() { return this.socket.readyState; }
  get bufferedAmount() { return this.socket.bufferedAmount; }
  send(bytes: Uint8Array<ArrayBuffer>) { this.socket.send(bytes); }
  close() { this.socket.close(); }
}

/** The relay carries pairing and signaling. RFB prefers WebRTC and can fall back to the relay. */
export function connectPair(pair: Pair, role: 'owner' | 'viewer',
  ready: (channel: RfbChannel, mode: Mode, viewOnly: boolean) => void,
  closed: () => void) {
  const endpoint = new URL(`/bridge/${pair.id}/${role}`, pair.origin);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(endpoint);
  socket.binaryType = 'arraybuffer';
  const send = (message: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  let peer: RTCPeerConnection | undefined;
  let rtc: RTCDataChannel | undefined;
  let mode: Mode | undefined;
  let channel: RfbChannel | undefined;
  let viewOnly = true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let announced = false;
  const end = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    peer?.close();
    socket.close();
    closed();
  };
  socket.addEventListener('close', end);
  socket.addEventListener('open', () => socket.send(pair.ticket));

  function start() {
    if (!mode || channel || settled) return;
    if (mode === 'webrtc' && rtc?.readyState !== 'open') return;
    channel = mode === 'webrtc' ? rtc! : new RelayChannel(socket);
    if (role === 'viewer') {
      ready(channel, mode, viewOnly);
      send({ kind: 'rfb-ready' });
    }
  }

  function listen(data: RTCDataChannel) {
    rtc = data;
    data.binaryType = 'arraybuffer';
    data.addEventListener('open', () => role === 'owner' ? select('webrtc') : start());
    data.addEventListener('close', () => { if (mode === 'webrtc') end(); });
  }

  function select(chosen: Mode) {
    if (mode || settled) return;
    mode = chosen;
    clearTimeout(timeout);
    send({ kind: 'transport', mode });
    start();
    if (mode === 'relay') peer?.close();
  }

  let sequence = Promise.resolve();
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    sequence = sequence.then(async () => {
      if (settled) return;
      const signal = JSON.parse(event.data);
      switch (signal.kind) {
        case 'paired': {
          viewOnly = signal.viewOnly === true;
          if (role === 'owner') timeout = setTimeout(() => select('relay'), 6000);
          if (!globalThis.RTCPeerConnection) {
            if (role === 'owner') select('relay');
            return;
          }
          peer = new RTCPeerConnection({ iceServers: signal.iceServers, iceTransportPolicy: signal.relayOnly === true ? 'relay' : 'all' });
          peer.onicecandidate = ({ candidate }) => { if (candidate) send({ kind: 'ice', candidate: candidate.toJSON() }); };
          if (role === 'viewer') peer.ondatachannel = ({ channel }) => listen(channel);
          else {
            listen(peer.createDataChannel('rfb'));
            await peer.setLocalDescription(await peer.createOffer());
            send({ kind: 'offer', sdp: peer.localDescription?.sdp });
          }
          break;
        }
        case 'offer':
          if (role === 'viewer' && peer && !mode) {
            await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
            await peer.setLocalDescription(await peer.createAnswer());
            send({ kind: 'answer', sdp: peer.localDescription?.sdp });
          }
          break;
        case 'answer':
          if (role === 'owner' && !mode) await peer?.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          break;
        case 'ice':
          if (!mode) await peer?.addIceCandidate(signal.candidate);
          break;
        case 'transport':
          if (role === 'viewer' && !mode && (signal.mode === 'webrtc' || signal.mode === 'relay')) {
            mode = signal.mode;
            if (mode === 'relay') peer?.close();
            start();
          }
          break;
        case 'rfb-ready':
          if (role === 'owner' && channel && mode && !announced) {
            announced = true;
            ready(channel, mode, viewOnly);
          }
          break;
      }
    }).catch(() => { if (role === 'owner' && !mode) select('relay'); });
  });
  return end;
}

export function publishRfb(endpoint: string, channel: RfbChannel, close: () => void) {
  const local = new WebSocket(endpoint);
  local.binaryType = 'arraybuffer';
  channel.onmessage = ({ data }: MessageEvent) => {
    if (!(data instanceof ArrayBuffer) || local.readyState !== WebSocket.OPEN || local.bufferedAmount > 8 * 1024 * 1024) {
      close();
      return;
    }
    local.send(data);
  };
  local.onmessage = ({ data }) => {
    if (channel.bufferedAmount > 8 * 1024 * 1024) { close(); return; }
    for (let offset = 0; offset < data.byteLength; offset += 16_384) {
      channel.send(new Uint8Array(data, offset, Math.min(16_384, data.byteLength - offset)));
    }
  };
  local.onclose = close;
  local.onerror = close;
  return () => { local.close(); channel.close(); };
}
