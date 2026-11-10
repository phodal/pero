import { Extension } from '@tiptap/core';
import { isTemplateOrigin } from '@pero/notebook/templates';

/** Global editor attribute, including text blocks and section containers. */
export const NotebookTemplateOrigin = Extension.create<{ types: string[] }>({
  name: 'notebookTemplateOrigin',
  addOptions() { return { types: [] }; },
  addGlobalAttributes() {
    return [{ types: this.options.types, attributes: { templateOrigin: {
      default: null,
      parseHTML: element => {
        const encoded = element.getAttribute('data-notebook-template-origin');
        if (!encoded || encoded.length > 2 * 1024 * 1024) return null;
        try { const origin: unknown = JSON.parse(encoded); return isTemplateOrigin(origin) ? origin : null; }
        catch { return null; }
      },
      renderHTML: attrs => isTemplateOrigin(attrs.templateOrigin) ? { 'data-notebook-template-origin': JSON.stringify(attrs.templateOrigin) } : {},
    } } }];
  },
});
