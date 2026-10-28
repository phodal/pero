import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// One pending browser sign-in belongs to this running Desktop instance.
// The callback cannot choose an origin or supply a bearer credential.
export class DesktopLogin {
  private attempt?: { base: string; state: string; verifier: string; expires: number };
  private timer?: ReturnType<typeof setTimeout>;
  private completedCallback?: string;
  isCompletedCallback(value: string) { return value === this.completedCallback; }
  get pending() { return !!this.attempt; }
  cancel() { clearTimeout(this.timer); this.attempt = undefined; }
  begin(base: string, expired: () => void): string {
    this.cancel();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    this.attempt = { base, state, verifier, expires: Date.now() + 10 * 60_000 };
    this.timer = setTimeout(() => { this.cancel(); expired(); }, 10 * 60_000);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return `${base}/connect/desktop?${new URLSearchParams({ state, code_challenge: challenge })}`;
  }
  async complete(value: string): Promise<{ url: string; token: string }> {
    if (value.length > 1024) throw new Error('Invalid Desktop sign-in link. Start GitHub sign-in again.');
    const link = new URL(value);
    const state = link.searchParams.get('state') || '';
    const code = link.searchParams.get('code') || '';
    const attempt = this.attempt;
    if (link.protocol !== 'pero:' || link.hostname !== 'connect' || link.pathname !== '/callback' || link.username || link.password || link.port || link.hash
      || !/^[a-f0-9]{64}$/.test(code) || !/^[A-Za-z0-9_-]{43}$/.test(state)
      || [...link.searchParams.keys()].length !== 2 || !attempt || Date.now() >= attempt.expires
      || !timingSafeEqual(Buffer.from(state), Buffer.from(attempt.state))) {
      throw new Error('This sign-in link is expired or belongs to another Desktop. Start GitHub sign-in again.');
    }
    this.cancel();
    const response = await fetch(`${attempt.base}/auth/desktop/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: attempt.verifier }),
    });
    // A bounded response; never include credential bodies in errors or renderer events.
    const body = await response.body?.getReader();
    let data = '';
    if (body) for (;;) {
      const chunk = await body.read();
      if (chunk.done) break;
      data += Buffer.from(chunk.value).toString('utf8');
      if (data.length > 2048) { await body.cancel(); throw new Error('Invalid sign-in response. Start GitHub sign-in again.'); }
    }
    if (!response.ok) throw new Error('GitHub sign-in could not complete. Start GitHub sign-in again.');
    const result = JSON.parse(data);
    if (typeof result.token !== 'string' || !/^desktop_[a-zA-Z0-9_-]+\.secret_[a-zA-Z0-9_-]+$/.test(result.token) || result.token.length > 512)
      throw new Error('Invalid sign-in credential. Start GitHub sign-in again.');
    this.completedCallback = value;
    return { url: attempt.base, token: result.token };
  }
}
