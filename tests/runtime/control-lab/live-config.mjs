import { isAbsolute, resolve } from 'node:path';

// A fixture can only receive the fixed synthetic key, over IPv4 loopback. The
// production path ignores endpoint overrides and uses the official endpoint.
export function providerEndpoint({ fixture, key, endpoint, ledger, outputRoot }) {
  if (!fixture) {
    if (!key || key === 'local-control-lab-fixture') throw new Error('Invalid live provider credential');
    return 'https://api.deepseek.com';
  }
  const url = new URL(endpoint || '');
  if (key !== 'local-control-lab-fixture' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.search || url.hash || !ledger || !isAbsolute(ledger) ||
      resolve(ledger) !== ledger || !ledger.startsWith(resolve(outputRoot) + '/'))
    throw new Error('Invalid isolated provider fixture');
  return url.href;
}
