import { createHash } from 'node:crypto';
import { mkdir, writeFile, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JsonSource,
  ContentRead,
  OutputSelection,
  ContentChunk,
} from '../../../packages/content-source/index.ts';

/** Host-owned result files, scoped to the actual calling conversation. */
export class ContentArtifacts {
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  private directory(thread: string) {
    return join(this.root, createHash('sha256').update(thread).digest('hex'));
  }
  async select(thread: string, value: unknown): Promise<string> {
    const selection = new OutputSelection(JsonSource.fromValue(value));
    if (!selection.needsFile) return selection.source.text;
    const id = createHash('sha256').update(selection.source.text).digest('hex');
    const directory = this.directory(thread);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${id}.json`), selection.source.text, {
      mode: 0o600,
    });
    return selection.reference(id);
  }
  async read(thread: string, request: ContentRead) {
    const path = join(this.directory(thread), `${request.id}.json`);
    const file = await open(path, 'r');
    try {
      const { size } = await file.stat();
      const pointer =
        request.selection.kind === 'pointer'
          ? JsonSource.stored(await readFile(path, 'utf8')).pointer(
              request.selection.pointer,
            )
          : undefined;
      const selection = request.range(size, pointer);
      const buffer = Buffer.alloc(
        Math.min(request.limit, selection.end - selection.start),
      );
      const { bytesRead } = await file.read(
        buffer,
        0,
        buffer.length,
        selection.start,
      );
      return new ContentChunk(
        { id: request.id, bytes: size, mediaType: 'application/json' },
        selection,
        buffer.subarray(0, bytesRead),
        request.limit,
      );
    } finally {
      await file.close();
    }
  }
  async forget(thread: string) {
    await rm(this.directory(thread), { recursive: true, force: true });
  }
}
