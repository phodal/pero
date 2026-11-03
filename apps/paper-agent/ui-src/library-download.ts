import type { Api, Paper } from './types';

export type DownloadFormat = 'pdf' | 'tex';
export type DownloadStage = 'preparing' | 'pdf' | 'tex' | 'saving';
type Review = { status: string; draftId?: string; reviewId?: string; error?: string; pdf: { available: boolean }; tex: { available: boolean; reason?: string } };
type Selection = { bundleId: string | null; pdfResourceId: string | null; sourceResourceId: string | null; documentId: string | null };
type JobScope = { path: string; bundleId: string; resourceId: string };
type Job = { status: string; error?: string; localAvailable?: boolean; receipt?: { extractionWarnings?: string[] } };
export type SavedFiles = { pdf: string; tex?: string; texNote?: string; warnings?: string[] };

/** One explicit download action, using the existing inspection and acquisition owners. */
export async function downloadPaperFiles(api: Api, paper: Paper, format: DownloadFormat, signal: AbortSignal,
  progress: (stage: DownloadStage) => void, pdfSaved: () => Promise<void>,
  wait = () => new Promise<void>(resolve => setTimeout(resolve, 700))): Promise<SavedFiles> {
  const endpoint = `/api/papers/${encodeURIComponent(paper.id)}/files`;
  let inspecting: string | undefined;
  const pending: { active: JobScope | null } = { active: null };
  const check = () => { if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError'); };
  async function acquire(kind: DownloadFormat, selection: Selection) {
    const resourceId = kind === 'pdf' ? selection.pdfResourceId : selection.sourceResourceId;
    if (!resourceId || !selection.bundleId) return;
    progress(kind);
    pending.active = { path: `/api/research/${kind === 'pdf' ? 'pdf' : 'source'}`, bundleId: selection.bundleId, resourceId };
    const { path, ...scope } = pending.active;
    check();
    // Reconcile a previous click before starting; never replay an uncertain start.
    let job = await api.post<Job>(path, { operation: 'status', ...scope });
    check();
    if (job.status !== 'running' && !(job.status === 'completed' && job.localAvailable)) {
      job = await api.post<Job>(path, { operation: 'start', ...scope });
    }
    while (job.status === 'running') {
      await wait(); check();
      job = await api.post<Job>(path, { operation: 'status', ...scope });
    }
    check();
    if (job.status !== 'completed' || !job.localAvailable) throw Error(job.error || `Could not download ${kind === 'pdf' ? 'PDF' : 'TeX'}`);
    pending.active = null;
    return job;
  }
  try {
    progress('preparing'); check();
    let review = await api.post<Review>(endpoint, { operation: 'prepare' });
    while (review.status === 'inspecting') {
      inspecting = review.draftId;
      await wait(); check();
      review = await api.post<Review>(endpoint, { operation: 'prepare', draftId: inspecting });
    }
    inspecting = undefined; check();
    if (review.status !== 'ready' || !review.pdf.available) throw Error(review.error || 'PDF unavailable');
    if (format === 'tex' && !review.tex.available) throw Error(review.tex.reason || 'TeX unavailable');
    const selection = await api.post<Selection>(endpoint, { operation: 'confirm', draftId: review.draftId,
      reviewId: review.reviewId, pdf: true, tex: format === 'tex', confirmedDownloads: true });
    check();
    const pdf = await acquire('pdf', selection);
    progress('saving'); check();
    // Attach the acquired bytes to the original paper before exposing any reader.
    const { bundleId, documentId, pdfResourceId, sourceResourceId } = selection;
    const target = { bundleId, documentId, pdfResourceId };
    let saved = await api.post<SavedFiles>(endpoint, { operation: 'export', ...target, sourceResourceId: null });
    await pdfSaved();
    if (format === 'tex') {
      await acquire('tex', selection);
      progress('saving'); check();
      saved = await api.post<SavedFiles>(endpoint, { operation: 'export', ...target, sourceResourceId });
      if (!saved.tex) throw Error(saved.texNote || 'TeX unavailable');
    }
    return { ...saved, warnings: pdf?.receipt?.extractionWarnings ?? [] };
  } finally {
    if (signal.aborted) {
      if (inspecting) await api.post('/api/research/inspect', { draftId: inspecting, cancel: true });
      if (pending.active) { const { path, ...scope } = pending.active; await api.post(path, { operation: 'cancel', ...scope }); }
    }
  }
}
