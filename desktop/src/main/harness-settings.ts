import { safeStorage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { harnessEnvironment, providerConfiguration, type ProviderConfiguration } from './harness-environment';

type StoredHarness = ProviderConfiguration & { encrypted_api_key: string | null };

export class HarnessPreferences {
  private config: ProviderConfiguration;
  private key: string;
  private source = 'env';
  private status = 'ready';
  private error: string | null = null;
  private available = false;
  constructor(envFile: string, private settingsPath: string, private emit: (event: any) => void,
    private save: (fields: object) => Promise<void>) {
    const env = harnessEnvironment(envFile);
    this.config = { endpoint: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: env.DEEPSEEK_MODEL || 'deepseek-chat' };
    this.key = env.DEEPSEEK_API_KEY || '';
  }
  async initialize() {
    try {
      if (existsSync(this.settingsPath)) {
        const saved = JSON.parse(readFileSync(this.settingsPath, 'utf8')).harness as StoredHarness | undefined;
        if (saved) {
          this.config = providerConfiguration(saved.endpoint, saved.model);
          this.source = 'settings'; this.key = '';
          if (saved.encrypted_api_key) this.key = (await safeStorage.decryptStringAsync(Buffer.from(saved.encrypted_api_key, 'base64'))).result;
        }
      }
    } catch { this.key = ''; this.error = 'harness.storage_error'; }
  }
  environment(): NodeJS.ProcessEnv {
    return { DEEPSEEK_BASE_URL: this.config.endpoint, DEEPSEEK_MODEL: this.config.model, DEEPSEEK_API_KEY: this.key };
  }
  private publish() {
    this.emit({ version: 1, kind: 'harness_state', request_id: null, text: '', data: {
      ...this.config, credentialConfigured: !!this.key, source: this.source,
      persistenceAvailable: this.available, status: this.status, error: this.error,
    } });
  }
  async command(input: unknown) {
    const command = input as { action?: string; endpoint?: unknown; model?: unknown; api_key?: unknown; clear_key?: unknown };
    if (this.status === 'saving') return;
    try {
      this.available = await safeStorage.isAsyncEncryptionAvailable();
      if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) this.available = false;
      if (command.action === 'harness_get') { this.publish(); return; }
      if (command.action !== 'harness_save') throw new Error('harness.save_error');
      const config = providerConfiguration(command.endpoint, command.model);
      if (typeof command.api_key !== 'string' || command.api_key.length > 4096 || /[\s\x00-\x1f]/.test(command.api_key) || typeof command.clear_key !== 'boolean') throw new Error('harness.invalid_key');
      if (!this.available) throw new Error('harness.storage_error');
      const key = command.clear_key ? '' : command.api_key || this.key;
      const stored: StoredHarness = { ...config, encrypted_api_key: key ? (await safeStorage.encryptStringAsync(key)).toString('base64') : null };
      this.status = 'saving'; this.error = null; this.publish();
      await this.save({ settings: stored, api_key: key });
      this.config = config; this.key = key; this.source = 'settings'; this.status = 'saved';
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error && error.message.startsWith('harness.') ? error.message : 'harness.save_error';
    }
    this.publish();
  }
}
