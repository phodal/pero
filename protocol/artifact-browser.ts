// Scientific Viewer / shell UI boundary. Host still owns the catalog and bytes.
import type { LayoutPreferences, SessionArtifact } from './generated/host';

export type ArtifactView = NonNullable<LayoutPreferences['artifact_view']>;
export type ArtifactTarget = { thread_id: string; artifact_id: string; version: number };
export type ArtifactBrowserState = {
  thread_id: string;
  artifacts: SessionArtifact[];
  selected: ArtifactTarget | null;
  view: ArtifactView;
  preview_request?: number;
  inline?: boolean;
  source_message?: string;
  shell_document_bar?: boolean;
};
