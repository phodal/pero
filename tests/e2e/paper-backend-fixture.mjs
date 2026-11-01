// Only transform a disposable installed backend. Fail closed if its wiring drifts,
// rather than silently using live literature/PDF/thumbnail network fetches.
export function paperBackendFixture(server, pdfPath) {
  const marker = '# PERO_DISPOSABLE_PAPER_NETWORK_FIXTURE';
  if (server.includes(marker)) throw new Error('Paper backend fixture was already injected');
  const once = (source, target, replacement) => {
    if (source.split(target).length !== 2) throw new Error(`Expected exactly one Paper fixture seam: ${target}`);
    return source.replace(target, replacement);
  };
  const imports = 'from paper_agent.http import handler';
  const injected = once(server, imports, `${imports}\n${marker}\nfrom paper_agent.literature import LiteratureClient\nfrom paper_agent.pdf_files import PdfFiles\nfrom paper_agent.thumbnails import PaperThumbnails\nfrom discovery_fixture import fetch, thumbnail_fetch\nfrom io import BytesIO\nfrom pathlib import Path as FixturePath`);
  const call = 'handler(store, os.environ["PERO_APP_TOKEN"]';
  return once(injected, call, `${call}, literature=LiteratureClient(fetch), pdf_files=PdfFiles(lambda *_args, **_kwargs: BytesIO(FixturePath(${JSON.stringify(pdfPath)}).read_bytes())), thumbnails=PaperThumbnails(thumbnail_fetch)`);
}
