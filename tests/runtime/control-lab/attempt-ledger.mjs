// Reserve a whole process budget before starting it. Reservations are never
// returned: a crash or an unobserved HTTP attempt must not create new quota.
import { constants } from 'node:fs';
import { open, readFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export async function reserveAttempts(path, count) {
  if (!isAbsolute(path) || !Number.isInteger(count) || count < 1 || count > 6)
    throw new Error('A ledger absolute path and a reservation from 1 to 6 are required');
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  let file;
  try {
    try {
      file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Create the audit first: an orphan audit must keep all later launches
      // blocked, including when it contains no attempts.
      const audit = await open(`${path}.attempts`, 'wx', 0o600);
      try { await audit.sync(); } finally { await audit.close(); }
      file = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await file.writeFile(JSON.stringify({ version: 1, limit: 6, reserved: 0, reservations: [] }));
      await file.sync();
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      await file.close();
      file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    }
    const ledger = JSON.parse(await file.readFile({ encoding: 'utf8' }));
    if (ledger.version !== 1 || ledger.limit !== 6 || !Array.isArray(ledger.reservations) ||
        !ledger.reservations.every(item => Number.isInteger(item) && item >= 1 && item <= 6) ||
        ledger.reserved !== ledger.reservations.reduce((sum, item) => sum + item, 0) || ledger.reserved > 6)
      throw new Error('Invalid attempt ledger; refusing to start a provider process');
    const audit = await readFile(`${path}.attempts`, 'utf8');
    if (!/^(attempt\n)*$/.test(audit) || audit.length / 'attempt\n'.length > ledger.reserved)
      throw new Error('Invalid HTTP attempt audit; refusing to start a provider process');
    if (ledger.reserved + count > ledger.limit) throw new Error('budget-exhausted');
    ledger.reserved += count;
    ledger.reservations.push(count);
    const encoded = Buffer.from(JSON.stringify(ledger));
    await file.truncate(0);
    await file.write(encoded, 0, encoded.length, 0);
    await file.sync();
    return ledger;
  } finally {
    await file?.close();
    await lock.close();
    await unlink(lockPath);
  }
}
