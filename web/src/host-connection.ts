// Subscribe only once the renderer can consume events, then query current state.
// A live lifecycle event received during the query supersedes its older snapshot.
export async function connectHost<Event extends { kind: string }>(
  host: { onEvent(callback: (event: Event) => void): () => void; connect(): Promise<Event> },
  receive: (event: Event) => void,
): Promise<void> {
  let observedLifecycle = false;
  host.onEvent(event => {
    if (event.kind === 'ready' || event.kind === 'disconnected') observedLifecycle = true;
    receive(event);
  });
  const current = await host.connect();
  if (!observedLifecycle) receive(current);
}
