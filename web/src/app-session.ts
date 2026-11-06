type SessionSnapshot = { chats?: { id: string }[]; activeChat?: number; activeApp?: unknown; chatVisible?: boolean };
/** A Host navigation succeeds only after the selected existing conversation is visible. */
export async function openExistingAppSession(sessionId: string, ports: {
  snapshot(): SessionSnapshot;
  open(): void;
  frame(): Promise<void>;
  now(): number;
}) {
  if (!ports.snapshot().chats?.some(chat => chat.id === sessionId)) throw new Error('Session is no longer available');
  ports.open();
  const deadline = ports.now() + 5000;
  do {
    await ports.frame();
    const current = ports.snapshot();
    if (!current.activeApp && current.chatVisible && current.chats?.[current.activeChat ?? -1]?.id === sessionId) return;
  } while (ports.now() < deadline);
  throw new Error('Session did not open');
}
