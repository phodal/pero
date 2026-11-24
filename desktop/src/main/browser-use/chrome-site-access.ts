import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';

const originKey = z.string().refine(value => webOrigin(value) === value);
const savedDecision = z.enum(['allow', 'block']);
const decisions = z.record(originKey, savedDecision);
const consent = z.enum(['once', 'allow', 'decline', 'block']);

export type ChromeSiteConsent = z.infer<typeof consent>;
export type ChromeSiteAccessPort = {
  currentTurn(thread: string): symbol | undefined;
  prompt(thread: string, origin: string): Promise<unknown>;
};

/** Site consent is independent of whether the profile is paired. */
export class ChromeSiteAccess {
  private saved?: Promise<Record<string, z.infer<typeof savedDecision>>>;
  private reviews = Promise.resolve();
  private readonly oneTurn = new Map<string, { turn: symbol; pairing: string; decisions: Map<string, 'once' | 'decline'> }>();

  constructor(private readonly path: string, private readonly port: ChromeSiteAccessPort) {}

  async rules(): Promise<z.infer<typeof decisions>> {
    return this.saved ??= readFile(this.path, 'utf8').then(
      text => decisions.parse(JSON.parse(text)),
      error => {
        if (error.code === 'ENOENT') return {};
        throw error;
      },
    );
  }

  async status(thread: string, pairing: string, origin: string) {
    const stored = (await this.rules())[origin];
    if (stored) return stored === 'allow' ? 'allowed' : 'blocked';
    const active = this.oneTurn.get(thread);
    const decision = active?.pairing === pairing && active.turn === this.port.currentTurn(thread)
      ? active.decisions.get(origin) : undefined;
    return decision === 'once' ? 'allowed' : decision === 'decline' ? 'declined' : 'ask';
  }

  async clear() {
    await this.review(async () => {
      await this.save({});
      this.oneTurn.clear();
    });
  }

  async require(thread: string, pairing: string, origin: string, signal: AbortSignal) {
    const turn = this.port.currentTurn(thread);
    if (turn === undefined) throw new Error('Chrome site access requires a running conversation.');
    const checkTurn = () => {
      signal.throwIfAborted();
      if (this.port.currentTurn(thread) !== turn) throw new Error('The conversation turn changed during Chrome site approval.');
    };
    const allowed = async () => {
      const state = await this.status(thread, pairing, origin);
      checkTurn();
      if (state === 'blocked' || state === 'declined') throw new Error(`Chrome site access was ${state} for ${origin}.`);
      return state === 'allowed';
    };
    if (await allowed()) return false;
    return this.review(async () => {
      if (await allowed()) return true;
      const decision = consent.parse(await this.port.prompt(thread, origin));
      checkTurn();
      if (decision === 'allow' || decision === 'block')
        await this.save({ ...await this.rules(), [origin]: decision });
      else {
        let active = this.oneTurn.get(thread);
        if (active?.turn !== turn || active.pairing !== pairing) {
          active = { turn, pairing, decisions: new Map() };
          this.oneTurn.set(thread, active);
        }
        active.decisions.set(origin, decision);
      }
      if (decision === 'block' || decision === 'decline')
        throw new Error(`Chrome site access was ${decision === 'block' ? 'blocked' : 'declined'} for ${origin}.`);
      return true;
    });
  }

  forget(thread?: string) {
    if (thread) this.oneTurn.delete(thread);
    else this.oneTurn.clear();
  }

  private review<T>(operation: () => Promise<T>) {
    const result = this.reviews.then(operation);
    this.reviews = result.then(() => {}, () => {});
    return result;
  }

  private async save(rules: Record<string, z.infer<typeof savedDecision>>) {
    const pending = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(pending, JSON.stringify(rules), { flag: 'wx', mode: 0o600 });
    await rename(pending, this.path);
    this.saved = Promise.resolve(rules);
  }
}
