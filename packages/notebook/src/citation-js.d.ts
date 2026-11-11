/** The pinned Citation.js packages ship JavaScript without declarations. */
declare module '@citation-js/core' {
  export class Cite {
    constructor(input: string, options: { forceType: '@bibtex/text'; generateGraph: false });
    data: unknown;
  }
}
declare module '@citation-js/plugin-bibtex';
