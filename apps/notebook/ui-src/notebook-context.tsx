import { createContext, useContext } from 'react';
import type { NotebookDocument } from '@pero/notebook';

export const NOTEBOOK_OPEN_TARGET_EVENT = 'notebook-open-target';

/** Identity and current document shared by Notes and all procedure rich editors. */
export interface NotebookContextValue {
  entryId: string;
  revision: number;
  readonly: boolean;
  dirty: boolean;
  document: NotebookDocument;
  savedDocument?: NotebookDocument;
  saveRevision?(): void;
  saveDisabled?: boolean;
  saving?: boolean;
  getDocument(): NotebookDocument;
}
const NotebookContext = createContext<NotebookContextValue | null>(null);
export const NotebookContextProvider = NotebookContext.Provider;
export function useNotebookContext(): NotebookContextValue | null { return useContext(NotebookContext); }
