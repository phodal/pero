// Pairing validation adapted from Point browser/chrome-extension/relay.mjs at 2449d4b98.
export const EXTENSION_ID = 'aoodadgiknjemednghffapmffnljmioc';
export const RELAY_PROTOCOL = 'pero-browser-connector/1';
export const RELAY_PATH = '/v1/browser-connector/connect';
export const MAX_FRAME = 1024 * 1024;
export const PAIR_LIFETIME_MS = 120000;
const credential = /^[A-Za-z0-9_-]{43}$/;

export type Pairing = { protocol: typeof RELAY_PROTOCOL; baseUrl: string; ticket: string; expiresAt: number; label: string };

export function parseRelayPairing(value: string, now = Date.now()): Pairing {
  const pairing = JSON.parse(value) as Pairing;
  if (!pairing || pairing.protocol !== RELAY_PROTOCOL || typeof pairing.ticket !== 'string' ||
      !credential.test(pairing.ticket) || !Number.isSafeInteger(pairing.expiresAt) ||
      pairing.expiresAt <= now || pairing.expiresAt > now + PAIR_LIFETIME_MS ||
      typeof pairing.label !== 'string' || pairing.label.length > 160 ||
      typeof pairing.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(pairing.baseUrl))
    throw new Error('The Pero pairing code is invalid or expired.');
  const address = new URL(pairing.baseUrl);
  if (address.origin !== pairing.baseUrl) throw new Error('Invalid Pero Relay address.');
  return pairing;
}

export function webOrigin(value: string): string | undefined {
  if (!URL.canParse(value)) return;
  const url = new URL(value);
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url.origin;
}
