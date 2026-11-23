import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserRequest } from './request.ts';
import type { BrowserDialogAnswer } from './dialog.ts';

type BrowserReceiptSource = {
  thread: string;
  grantId: string;
  tabId: string;
  origin: string;
  url: string;
  action: BrowserRequest['action'];
};

export function browserEvidenceDirectory(root: string, thread: string) {
  return join(root, createHash('sha256').update(thread).digest('hex'));
}

export async function startBrowserReceipt(root: string, source: BrowserReceiptSource) {
  const id = randomUUID();
  const entry = { id, ...source, time: new Date().toISOString() };
  const directory = browserEvidenceDirectory(root, source.thread);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const record = (suffix: '' | '.intent' | '.result', value: object) =>
    writeFile(join(directory, id + suffix + '.json'), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  return { id, entry, directory, record };
}

export async function answerBrowserDialog(
  { id, entry, record }: Awaited<ReturnType<typeof startBrowserReceipt>>,
  { dialogId, decision }: BrowserDialogAnswer,
  dispatch: () => Promise<{ rejected: string } | null>,
  signal: AbortSignal,
) {
  await record('.intent', { ...entry, dialogId, decision });
  signal.throwIfAborted();
  let effect: { outcome: 'dispatched' | 'rejected' | 'unknown'; reason?: string };
  try {
    const result = await dispatch();
    effect = result ? { outcome: 'rejected', reason: result.rejected } : { outcome: 'dispatched' };
  } catch (error) {
    effect = { outcome: 'unknown', reason: error instanceof Error ? error.message : String(error) };
  }
  await record('.result', { id, dialogId, decision, ...effect });
  return { receiptId: id, dialogId, decision, ...effect, verified: false };
}
