/** Host owns project identities and references; Notebook receives no settings-write API. */
export interface NotebookProjectCatalog {
  projects: { id: string; title: string; entries: { id: string; revision: string }[] }[];
  entries: { id: string; title: string; revision: string }[];
}
export interface NotebookProjectLink {
  projectId: string; entryId: string; revision: number; expectedRevision: string | null; linked: boolean; readOnly: boolean;
}
async function request(input: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch('/host/notebook-projects', { method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    keepalive: 'operation' in input && input.operation === 'cancel' });
  if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || 'Host projects are unavailable. Reload to retry.');
  return response.json();
}
function catalog(value: unknown): NotebookProjectCatalog {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const id = (item: unknown): item is string => typeof item === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item);
  const entryId = (item: unknown): item is string => typeof item === 'string' && /^[a-f0-9]{32}$/.test(item);
  const revision = (item: unknown): item is string => typeof item === 'string' && /^[1-9][0-9]{0,19}$/.test(item);
  const title = (item: unknown): item is string => typeof item === 'string' && [...item].length > 0 && [...item].length <= 200;
  if (!object(value) || !Array.isArray(value.projects) || value.projects.length > 128 || !Array.isArray(value.entries) ||
      value.projects.some(project => !object(project) || !id(project.id) || !title(project.title) || !Array.isArray(project.entries) || project.entries.length > 256 ||
        project.entries.some(entry => !object(entry) || !entryId(entry.id) || !revision(entry.revision))) ||
      value.entries.some(entry => !object(entry) || !entryId(entry.id) || !title(entry.title) || !revision(entry.revision))) throw new Error('Host returned invalid Notebook project references');
  return { projects: value.projects.map(project => ({ id: project.id, title: project.title,
    entries: project.entries.map((entry: {id: string; revision: string}) => ({ id: entry.id, revision: entry.revision })) })),
  entries: value.entries.map(entry => ({ id: entry.id, title: entry.title, revision: entry.revision })) };
}
export async function listNotebookProjects(signal?: AbortSignal): Promise<NotebookProjectCatalog> {
  return catalog(await request({ operation: 'list' }, signal));
}
export async function setNotebookProjectLink(change: NotebookProjectLink, signal?: AbortSignal): Promise<NotebookProjectCatalog | null> {
  const result = await request({ operation: 'set', change }, signal) as Record<string, unknown>;
  if (result?.state === 'cancelled') return null;
  if (result?.state !== 'completed') throw new Error('Project change is unconfirmed. Reload Host projects before trying again.');
  return catalog(result);
}
export async function cancelNotebookProjectLink(entryId: string): Promise<void> {
  await request({ operation: 'cancel', entryId });
}
