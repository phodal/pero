// Public contribution coordination; credentials remain in RemoteAdapter and Git/ACP in Host.
import { randomUUID } from 'node:crypto';
import { shell } from 'electron';

type Claimant = { id: string; name: string };
type PullRequest = { url: string; branch: string; head_sha: string; source_revision: string };
type ContributionState = 'available' | 'claimed' | 'submitted' | 'closed' | 'source_changed' | 'running' | 'accepted';
export class PublicContribution {
  private constructor(readonly task_id: string, readonly title: string, readonly description: string,
    readonly project: string, readonly source_url: string, readonly repository: string,
    readonly source_revision: string, readonly state: ContributionState,
    readonly claimed_by?: Claimant, readonly pull_request?: PullRequest) { Object.freeze(this); }
  static parse(input: unknown): PublicContribution {
    const value = input as Record<string, unknown>;
    if (!value || typeof value !== 'object') throw new Error('Invalid public contribution');
    const read = (key: string, max: number, allowEmpty = false) => {
      const result = value[key];
      if (typeof result !== 'string' || (!result && !allowEmpty) || result.length > max) throw new Error(`Invalid contribution ${key}`);
      return result;
    };
    const task_id = read('task_id', 128), repository = read('repository', 256), source_url = read('source_url', 2048);
    if (!/^[\w-]+$/.test(task_id) || !/^[\w-]+\/[\w.-]+$/.test(repository) || repository.split('/').some(v => v === '.' || v === '..')) throw new Error('Invalid contribution source');
    const source = new URL(source_url);
    if (source.origin !== 'https://github.com' || source.username || source.password || !source.pathname.startsWith(`/${repository}/`)) throw new Error('Invalid public source URL');
    const state = read('state', 30) as ContributionState;
    if (!['available', 'claimed', 'submitted', 'closed', 'source_changed', 'running', 'accepted'].includes(state)) throw new Error('Invalid contribution state');
    let claimed_by: Claimant | undefined;
    if (value.claimed_by) {
      const claimant = value.claimed_by as Claimant;
      if (typeof claimant.id !== 'string' || typeof claimant.name !== 'string') throw new Error('Invalid contribution claimant');
      claimed_by = { id: claimant.id, name: claimant.name };
    }
    let pull_request: PullRequest | undefined;
    if (value.pull_request) {
      const pr = value.pull_request as PullRequest;
      if (typeof pr.url !== 'string' || !new RegExp(`^https://github\\.com/${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/[1-9][0-9]*$`).test(pr.url)
        || typeof pr.branch !== 'string' || typeof pr.head_sha !== 'string' || typeof pr.source_revision !== 'string') throw new Error('Invalid contribution pull request');
      pull_request = { url: pr.url, branch: pr.branch, head_sha: pr.head_sha, source_revision: pr.source_revision };
    }
    const title = read('title', 1000);
    const description = read('description', 64000, true);
    const titlePrefix = `${title}\n\n`;
    return new PublicContribution(task_id, title, description.startsWith(titlePrefix) ? description.slice(titlePrefix.length) : description,
      read('project', 128), source_url, repository, read('source_revision', 256), state, claimed_by, pull_request);
  }
}
export type LocalContribution = {
  task_id: string; repository: string; workspace: string; branch: string; base: string;
  title: string; source_url: string; head: string; review_token: string; diff: string;
  changed_files: string[]; pr_url: string | null; status: string; gh_available: boolean; gh_authenticated: boolean;
  thread_id?: string; session_state?: string; source_revision: string;
};
type HostEvent = { kind: string; request_id?: string | null; thread_id?: string; text?: string; data?: any };
type Request = (path: string, method?: string, body?: unknown) => Promise<unknown>;
type Ports = { request: Request; identity(): { id: string } | null | undefined; host(request: object): void; chooseParent(): Promise<string | undefined> };
export class DesktopContributions {
  private state: { loading: boolean; error: string | null; contributions: PublicContribution[]; selected_task_id: string | null;
    detail: PublicContribution | null; local: LocalContribution | null; has_more: boolean } = {
    loading: false, error: null, contributions: [], selected_task_id: null, detail: null, local: null, has_more: false,
  };
  private nextCursor: string | null = null;
  private bindings = new Map<string, LocalContribution>();
  private pending = new Map<string, { resolve(data: LocalContribution): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private prompts = new Map<string, string>();
  private closed = false;
  constructor(private emit: (event: object) => void, private ports: Ports) {}
  private publish() { if (!this.closed) this.emit({ version: 1, kind: 'contributor_state', request_id: null, text: '', data: this.state }); }
  private async host(operation: string, fields: object): Promise<LocalContribution> {
    const id = `contribution-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The local operation timed out. Check the workspace before retrying.')); }, 180_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ports.host({ method: 'contribution', id, operation, ...fields }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  accept(event: HostEvent): boolean {
    if (event.kind === 'contribution_result' || event.kind === 'contribution_error') {
      const pending = this.pending.get(event.request_id || '');
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(event.request_id!);
        if (event.kind === 'contribution_error') pending.reject(new Error(event.text || event.data?.message || 'Local contribution failed'));
        else pending.resolve(event.data as LocalContribution);
      }
      return true;
    }
    const binding = [...this.bindings.values()].find(value => value.thread_id === event.thread_id);
    if (!binding) return false;
    const states: Record<string, string> = { session_connecting: 'connecting', session_ready: 'idle', turn_started: 'running', turn_finished: 'idle', session_error: 'idle', session_closed: 'closed', session_auth_required: 'auth_required', session_auth_error: 'auth_required', session_authenticated: 'idle' };
    if (states[event.kind]) binding.session_state = states[event.kind];
    if (event.kind === 'turn_started') { binding.status = 'ready'; binding.review_token = ''; }
    if (event.kind === 'session_ready' && this.prompts.has(event.thread_id!)) {
      const text = this.prompts.get(event.thread_id!)!; this.prompts.delete(event.thread_id!);
      binding.session_state = 'running';
      this.ports.host({ action: 'prompt', thread_id: event.thread_id, text });
    }
    if (this.state.selected_task_id === binding.task_id) this.state.local = binding;
    if (states[event.kind]) this.publish();
    return false;
  }
  close() {
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('The local runtime stopped. Reopen Desktop.')); }
    this.pending.clear(); this.prompts.clear();
  }
  reset() { this.state = { loading: false, error: null, contributions: [], selected_task_id: null, detail: null, local: null, has_more: false }; this.publish(); }
  private async detail(task_id: string) { return PublicContribution.parse(await this.ports.request(`/api/client/v1/contributions/${task_id}`)); }
  private async owned(task_id: string) {
    const detail = await this.detail(task_id);
    if (detail.claimed_by?.id !== this.ports.identity()?.id) throw new Error('Claim this public task before working on it.');
    if (!['claimed', 'submitted'].includes(detail.state)) throw new Error('This task changed or is no longer available. Refresh and review its current source.');
    this.state.detail = detail;
    return detail;
  }
  private idle(local: LocalContribution) {
    if (local.thread_id && !['idle', 'closed', 'auth_required'].includes(local.session_state || '')) throw new Error('Stop the Agent or wait for it to finish before reviewing or publishing.');
  }
  private async submit(detail: PublicContribution, local: LocalContribution) {
    if (!local.pr_url) throw new Error('No pull request has been created.');
    this.state.detail = PublicContribution.parse(await this.ports.request(`/api/client/v1/contributions/${detail.task_id}/pull-request`, 'POST', {
      url: local.pr_url, branch: local.branch, head_sha: local.head, source_revision: local.source_revision,
    }));
  }
  async command(input: unknown): Promise<void> {
    if (this.state.loading) return;
    const command = input as { action?: string; task_id?: string; agent_id?: string };
    const action = command?.action;
    if (!action || !['refresh', 'more', 'select', 'claim', 'release', 'start', 'review', 'publish', 'submit', 'source', 'open_pr', 'open_session', 'gh_help'].map(value => `remote_contribution_${value}`).includes(action)) throw new Error('Invalid contribution action');
    const task_id = command.task_id || this.state.selected_task_id;
    if (!['remote_contribution_refresh', 'remote_contribution_more'].includes(action) && (!task_id || !/^[\w-]+$/.test(task_id))) throw new Error('Select a public task first.');
    this.state.loading = true; this.state.error = null; this.publish();
    try {
      if (action === 'remote_contribution_refresh' || action === 'remote_contribution_more') {
        const more = action === 'remote_contribution_more';
        const page = await this.ports.request(`/api/client/v1/contributions?limit=50${more && this.nextCursor ? `&cursor=${encodeURIComponent(this.nextCursor)}` : ''}`) as { contributions: unknown[]; has_more: boolean; next_cursor: string | null };
        if (!Array.isArray(page.contributions) || typeof page.has_more !== 'boolean') throw new Error('Invalid public task list');
        this.state.contributions = [...(more ? this.state.contributions : []), ...page.contributions.map(PublicContribution.parse)];
        this.state.has_more = page.has_more; this.nextCursor = page.next_cursor;
        if (this.state.selected_task_id) this.state.detail = await this.detail(this.state.selected_task_id);
      } else {
        const id = task_id!;
        this.state.selected_task_id = id;
        this.state.detail = await this.detail(id);
        this.state.local = this.bindings.get(id) || null;
        if (action === 'remote_contribution_claim' || action === 'remote_contribution_release') {
          if (action.endsWith('_release') && this.state.local) this.idle(this.state.local);
          this.state.detail = PublicContribution.parse(await this.ports.request(`/api/client/v1/contributions/${id}/${action.endsWith('_claim') ? 'claim' : 'release'}`, 'POST', {}));
        } else if (action === 'remote_contribution_start') {
          const detail = await this.owned(id);
          const current = this.bindings.get(id);
          if (current?.thread_id && current.session_state !== 'closed') { this.openSession(current); return; }
          const parent = await this.ports.chooseParent();
          if (!parent) return;
          const local = await this.host('prepare', { task_id: id, repository: detail.repository, parent, title: detail.title, source_url: detail.source_url, source_revision: detail.source_revision });
          this.bindings.set(id, local); this.state.local = local;
          if (local.pr_url) return; // A recovered publication is linked explicitly, without replaying coding or writes.
          const thread_id = `contribution-${randomUUID()}`;
          Object.assign(local, { thread_id, session_state: 'connecting' });
          const agent_id = typeof command.agent_id === 'string' && /^[\w-]+$/.test(command.agent_id) ? command.agent_id : 'codex';
          this.prompts.set(thread_id, `${detail.title}\n\n${detail.description}\n\nSource: ${detail.source_url}\nSource revision: ${detail.source_revision}\n\nImplement this public contribution in the selected workspace. Inspect the repository instructions, implement the change and run appropriate checks. Do not commit, push, fork or open a pull request; the contributor will review and publish with Pero.`);
          this.emit({ version: 1, kind: 'contributor_session', request_id: null, text: detail.title, thread_id, data: { agent_id, workspace: local.workspace, task_id: id } });
          this.ports.host({ action: 'workspace', path: local.workspace });
          this.ports.host({ action: 'new_session', thread_id, agent_id });
        } else if (action === 'remote_contribution_review' || action === 'remote_contribution_publish' || action === 'remote_contribution_submit') {
          const detail = await this.owned(id), previous = this.bindings.get(id);
          if (!previous) throw new Error('Start this contribution and choose its workspace first.');
          this.idle(previous);
          if (previous.source_revision !== detail.source_revision) throw new Error('The public source changed. Refresh the task before publishing. Your local changes are retained.');
          if (action === 'remote_contribution_submit') await this.submit(detail, previous);
          else {
            const operation = action === 'remote_contribution_review' ? 'review' : 'publish';
            const local = await this.host(operation, { task_id: id, workspace: previous.workspace, ...(operation === 'publish' ? { review_token: previous.review_token } : {}) });
            if (operation === 'review') local.status = 'review';
            Object.assign(previous, local); this.state.local = previous;
            if (operation === 'publish') await this.submit(detail, previous);
          }
        } else if (action === 'remote_contribution_gh_help') await shell.openExternal('https://cli.github.com/');
        else if (action === 'remote_contribution_source') await shell.openExternal(this.state.detail.source_url);
        else if (action === 'remote_contribution_open_pr') {
          const url = this.state.detail.pull_request?.url || this.state.local?.pr_url;
          if (url) await shell.openExternal(url);
        } else if (action === 'remote_contribution_open_session' && this.state.local) this.openSession(this.state.local);
        if (this.state.detail) {
          const item = this.state.contributions.findIndex(value => value.task_id === id);
          if (item >= 0) this.state.contributions[item] = this.state.detail;
        }
      }
    } catch (error) { this.state.error = error instanceof Error ? error.message.slice(0, 1000) : 'Contribution failed. Retry after checking the workspace.'; }
    finally { this.state.loading = false; this.publish(); }
  }
  private openSession(local: LocalContribution) {
    this.emit({ version: 1, kind: 'contributor_session', request_id: null, text: local.title, thread_id: local.thread_id, data: { workspace: local.workspace, task_id: local.task_id } });
  }
}
