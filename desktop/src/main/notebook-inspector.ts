import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {AppWriteDefinition} from './app-write.ts';

/** First product consumer: the existing saved-entry read remains the sole owner. */
export class NotebookInspector {
  static readonly uri = 'ui://pero/notebook/inspector-v1';
  static readonly tool = 'app__notebook__read-entry';
  private assets: string;
  constructor(assets: string) { this.assets = assets; }
  supports(definition: AppWriteDefinition) {
    return definition.app === 'notebook' && definition.name === 'read-entry'
      && definition.path === '/api/agent-read';
  }
  async read() {
    return {contents:[{uri:NotebookInspector.uri, mimeType:RESOURCE_MIME_TYPE,
      text:await readFile(join(this.assets, 'notebook-inspector.html'), 'utf8'), _meta:{ui:{csp:{}}}}]};
  }
}
