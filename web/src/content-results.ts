import type {
  ContentChunk,
  ConversationReadParameters,
} from '../../packages/content-source/index';
import type { HostEvent } from './bootstrap';

export type ContentLoadCommand = {
  action: 'read_result';
  thread_id: string;
  tool_call_id: string;
  artifact_id: string;
  request_id: string;
};
const pending = new Map<string, AbortController>();

/** UI reads never enter the Agent's tool-result or prompt stream. */
export async function loadContentResult(
  command: ContentLoadCommand,
  read: (request: ConversationReadParameters) => Promise<ContentChunk>,
  deliver: (event: HostEvent) => void,
) {
  const controller = new AbortController();
  pending.set(command.request_id, controller);
  const event = (status: 'ready' | 'error', text: string): HostEvent => ({
    version: 1,
    kind: 'content_document',
    request_id: command.request_id,
    thread_id: command.thread_id,
    text,
    data: {
      tool_call_id: command.tool_call_id,
      artifact_id: command.artifact_id,
      status,
    },
  });
  try {
    let request: ConversationReadParameters = {
      thread_id: command.thread_id,
      id: command.artifact_id,
    };
    const parts: string[] = [];
    for (;;) {
      const chunk = await read(request);
      if (controller.signal.aborted) return;
      parts.push(chunk.text);
      if (!chunk.nextRead) break;
      request = { thread_id: command.thread_id, ...chunk.nextRead };
    }
    deliver(event('ready', parts.join('')));
  } catch (error) {
    if (!controller.signal.aborted)
      deliver(
        event('error', error instanceof Error ? error.message : String(error)),
      );
  } finally {
    pending.delete(command.request_id);
  }
}

export function cancelContentResult(request_id: string) {
  pending.get(request_id)?.abort();
}
