/** srcdoc inherits the embedding App URL as its base. Keep generated fragment
 * links inside the inert preview; standalone downloads retain relative hrefs.
 * Input is trusted renderer output with authored markup already escaped. */
export function publicationPreviewHtml(html: string): string {
  return html.replace(/ href="#/g, ' href="about:srcdoc#');
}
