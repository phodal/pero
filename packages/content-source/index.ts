/** A JSON source owns its spelling; projections refer to ranges, never decoded numbers. */
export class JsonSource {
  readonly text: string;
  private constructor(text: string) {
    this.text = text;
  }
  static fromValue(value: unknown): JsonSource {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error('The result is not JSON data');
    return new JsonSource(text);
  }
  /** Only the store reads documents it previously serialized itself. */
  static stored(text: string): JsonSource {
    return new JsonSource(text);
  }

  get bytes(): number {
    return Buffer.byteLength(this.text);
  }

  pointer(pointer: string): { start: number; end: number } {
    if (pointer && !pointer.startsWith('/'))
      throw new Error('Use an RFC 6901 JSON Pointer');
    let range = { start: 0, end: this.text.length };
    const tokens = pointer
      ? pointer
          .slice(1)
          .split('/')
          .map((token) => {
            if (/~(?:[^01]|$)/.test(token))
              throw new Error('Invalid JSON Pointer escape');
            return token.replace(/~1/g, '/').replace(/~0/g, '~');
          })
      : [];
    for (const token of tokens) {
      let found: typeof range | undefined;
      for (const entry of this.children(range)) {
        if (entry.key === token) {
          found = entry.range;
          break;
        }
      }
      if (!found) throw new Error('JSON Pointer does not exist');
      range = found;
    }
    return {
      start: Buffer.byteLength(this.text.slice(0, range.start)),
      end: Buffer.byteLength(this.text.slice(0, range.end)),
    };
  }

  private *children(range: { start: number; end: number }) {
    const text = this.text;
    let i = range.start;
    while (/\s/.test(text[i] || 'x')) i++;
    const object = text[i] === '{';
    if (!object && text[i] !== '[') return;
    i++;
    let index = 0;
    while (i < range.end) {
      while (/[\s,]/.test(text[i] || 'x')) i++;
      if (text[i] === '}' || text[i] === ']') return;
      let key = String(index++);
      if (object) {
        const end = this.valueEnd(i);
        key = JSON.parse(text.slice(i, end)); // Only keys are decoded, never data values.
        i = end;
        while (/\s/.test(text[i] || 'x')) i++;
        if (text[i++] !== ':') throw new Error('Stored JSON is invalid');
        while (/\s/.test(text[i] || 'x')) i++;
      }
      const start = i;
      i = this.valueEnd(i);
      yield { key, range: { start, end: i } };
    }
  }

  private valueEnd(start: number): number {
    const text = this.text;
    let string = false,
      escaped = false,
      depth = 0;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (string) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') {
          string = false;
          if (depth === 0) return i + 1;
        }
      } else if (c === '"') string = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        if (depth === 0) return i;
        if (--depth === 0) return i + 1;
      } else if (depth === 0 && /[\s,]/.test(c)) return i;
    }
    return text.length;
  }
}

export type ContentSelection =
  | { kind: 'bytes'; start: number; end?: number }
  | { kind: 'pointer'; pointer: string };
export class ContentRead {
  readonly id: string;
  readonly selection: ContentSelection;
  readonly limit: number;
  private constructor(id: string, selection: ContentSelection, limit: number) {
    this.id = id;
    this.selection = selection;
    this.limit = limit;
  }
  range(bytes: number, pointer?: { start: number; end: number }) {
    const range =
      this.selection.kind === 'pointer'
        ? pointer!
        : { start: this.selection.start, end: this.selection.end ?? bytes };
    if (range.start > bytes || range.end > bytes)
      throw new Error('The byte range exceeds the artifact');
    return range;
  }
  static parse(value: unknown): ContentRead {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Expected content read arguments');
    const p = value as Record<string, unknown>;
    if (
      Object.keys(p).some(
        (key) =>
          !['id', 'startByte', 'endByte', 'pointer', 'maxBytes'].includes(key),
      )
    )
      throw new Error('Unknown content read argument');
    if (typeof p.id !== 'string' || !/^[a-f0-9]{64}$/.test(p.id))
      throw new Error('Invalid artifact id');
    const limit = p.maxBytes ?? 16384;
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 16 ||
      limit > 16384
    )
      throw new Error('maxBytes must be 16–16384');
    let selection: ContentSelection;
    if (p.pointer !== undefined) {
      if (
        typeof p.pointer !== 'string' ||
        p.startByte !== undefined ||
        p.endByte !== undefined
      )
        throw new Error('Choose a pointer or a byte range');
      selection = { kind: 'pointer', pointer: p.pointer };
    } else {
      const start = p.startByte ?? 0,
        end = p.endByte;
      if (
        typeof start !== 'number' ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        (end !== undefined &&
          (typeof end !== 'number' ||
            !Number.isSafeInteger(end) ||
            end < start))
      )
        throw new Error('Invalid byte range');
      selection = { kind: 'bytes', start, end: end as number | undefined };
    }
    return new ContentRead(p.id, selection, limit);
  }
}

/** The model limit is independent of the complete artifact and the user's view. */
export class OutputSelection {
  readonly source: JsonSource;
  readonly inlineBytes: number;
  constructor(source: JsonSource, inlineBytes = 16384) {
    this.source = source;
    this.inlineBytes = inlineBytes;
  }
  get needsFile(): boolean {
    return this.source.bytes > this.inlineBytes;
  }
  reference(id: string) {
    let end = Math.min(1024, this.source.text.length);
    if (end && /[\uD800-\uDBFF]/.test(this.source.text[end - 1])) end--;
    return JsonSource.fromValue({
      type: 'content_reference',
      artifact: {
        id,
        mediaType: 'application/json',
        bytes: this.source.bytes,
        sha256: id,
      },
      preview: this.source.text.slice(0, end),
      omitted: true,
      read: {
        tool: 'content_read',
        arguments: { id, startByte: 0, maxBytes: 16384 },
      },
      note: 'The preview is incomplete. Use content_read with a JSON Pointer or byte range; numeric text is preserved. Follow nextRead only when more data is needed.',
    }).text;
  }
}

export type ContentReadParameters = {
  id: string;
  startByte?: number;
  endByte?: number;
  pointer?: string;
  maxBytes?: number;
};
export type ConversationReadParameters = ContentReadParameters & {
  thread_id: string;
};

export class ConversationContentRead {
  readonly thread: string;
  readonly request: ContentRead;
  private constructor(thread: string, request: ContentRead) {
    this.thread = thread;
    this.request = request;
  }
  static parse(value: unknown): ConversationContentRead {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid content request');
    const { thread_id, ...parameters } = value as Record<string, unknown>;
    if (typeof thread_id !== 'string' || !thread_id || thread_id.length > 128)
      throw new Error('Invalid conversation');
    return new ConversationContentRead(
      thread_id,
      ContentRead.parse(parameters),
    );
  }
}

/** Actual UTF-8 boundaries and continuation belong to the slice, not its transport. */
export class ContentChunk {
  readonly artifact: {
    id: string;
    bytes: number;
    mediaType: 'application/json';
  };
  readonly startByte: number;
  readonly endByte: number;
  readonly selectionEndByte: number;
  readonly text: string;
  readonly truncated: boolean;
  readonly nextRead: {
    id: string;
    startByte: number;
    endByte: number;
    maxBytes: number;
  } | null;
  constructor(
    artifact: { id: string; bytes: number; mediaType: 'application/json' },
    selection: { start: number; end: number },
    buffer: Uint8Array,
    limit: number,
  ) {
    const input = Buffer.from(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    let start = 0,
      end = input.length;
    while (start < end && (input[start] & 0xc0) === 0x80) start++;
    let boundary = end - 1;
    while (boundary >= start && (input[boundary] & 0xc0) === 0x80) boundary--;
    if (boundary >= start) {
      const c = input[boundary],
        width = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
      if (boundary + width > end) {
        if (selection.start + end === selection.end)
          throw new Error(
            'endByte splits a UTF-8 character; use a JSON Pointer or a complete byte boundary',
          );
        end = boundary;
      }
    }
    this.artifact = artifact;
    this.startByte = selection.start + start;
    this.endByte = selection.start + end;
    this.selectionEndByte = selection.end;
    this.text = input.subarray(start, end).toString('utf8');
    this.truncated = this.endByte < selection.end;
    this.nextRead = this.truncated
      ? {
          id: artifact.id,
          startByte: this.endByte,
          endByte: selection.end,
          maxBytes: limit,
        }
      : null;
  }
}
