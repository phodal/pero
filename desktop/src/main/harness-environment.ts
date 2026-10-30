import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Only provider configuration crosses from the operator's dotenv into the Host.
export function harnessEnvironment(path: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const file = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  return Object.fromEntries(['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL'].flatMap(key => {
    const value = inherited[key] ?? file[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

export type ProviderConfiguration = { endpoint: string; model: string };

// Validate at the Desktop boundary, before persistence or process configuration.
export function providerConfiguration(endpoint: unknown, model: unknown): ProviderConfiguration {
  if (typeof model !== 'string' || !model.trim() || model.length > 256 || /[\s\x00-\x1f]/.test(model)) throw new Error('harness.invalid_model');
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || endpoint.trim() !== endpoint) throw new Error('harness.invalid_endpoint');
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('harness.invalid_endpoint'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('harness.invalid_endpoint');
  return { endpoint: url.toString().replace(/\/$/, ''), model };
}
