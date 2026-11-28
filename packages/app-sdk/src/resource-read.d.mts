export const PAPER_EVIDENCE: string;
export const PAPER_DIGEST: string;
export const DOMAIN_PROVENANCE: string;

export interface PaperResourceRef {
  ownerHost: string;
  sharedProject?: string;
  localProject: string;
  app: string;
  appInstance: string;
  appVersion: string;
  kind: string;
  id: string;
  revision: string;
  class: 'immutable' | 'observed';
}

export interface PaperReadRequest {
  resource: PaperResourceRef;
}

export interface PaperReadResult {
  ownerHost: string;
  revision: string;
  digest: string;
  mediaType: string;
  body: Uint8Array;
  provenance: string;
}

export interface PaperReadTransport {
  read(request: PaperReadRequest): Promise<{
    ownerHost: string;
    revision: string;
    digest: string;
    mediaType: string;
    body: string | Uint8Array;
    provenance: string;
  }>;
}

export function readPaperResource(transport: PaperReadTransport, request: PaperReadRequest): Promise<PaperReadResult>;
