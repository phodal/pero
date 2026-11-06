import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppChat, useAppContext } from '@pero/app-sdk';
import { Feedback } from '@pero/app-sdk/ui';
import { artifactContext, artifactLocator } from './artifact-source';
import { ArtifactDocument } from './artifact-document';
import { ArtifactBrowser } from './artifact-browser';
import './artifact-preview.css';

/** Preserve direct links to one frozen version beside the conversation browser entry. */
function StandaloneArtifact({ parameters }: { parameters: URLSearchParams }) {
  const { locale } = useAppContext(), chat = useAppChat();
  let locator;
  try { locator = artifactLocator(parameters); }
  catch (reason) { return <main className="artifact-surface artifact-empty"><Feedback kind="error">{reason instanceof Error ? reason.message : String(reason)}</Feedback></main>; }
  return <main className="artifact-surface" aria-label={locale === 'zh-CN' ? '会话产物' : 'Conversation artifact'}>
    <ArtifactDocument locator={locator} onDiscuss={async (snapshot, selection) => { await chat.compose(artifactContext(snapshot, selection, locale)); }} />
  </main>;
}

const parameters = new URLSearchParams(location.search);
createRoot(document.getElementById('app')!).render(<AppProvider>{parameters.has('artifact_id') || parameters.has('version')
  ? <StandaloneArtifact parameters={parameters} /> : <ArtifactBrowser threadId={parameters.get('thread_id') ?? ''} />}</AppProvider>);
