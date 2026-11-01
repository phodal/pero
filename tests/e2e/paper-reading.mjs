// Independent offline reading acceptance; shares the existing Desktop artifact.
await import('./paper-structured-reading.mjs');
// Exercise the reader's shared anchors and stale-navigation guards through the
// existing synthetic Desktop fixture. Skip its unrelated discovery tour to keep
// this reading aggregate inside the unchanged acceptance budget.
const previousPdfOnly = process.env.PERO_PAPER_PDF_ONLY;
process.env.PERO_PAPER_PDF_ONLY = '1';
try {
  await import('./paper-agent.mjs');
} finally {
  if (previousPdfOnly === undefined) delete process.env.PERO_PAPER_PDF_ONLY;
  else process.env.PERO_PAPER_PDF_ONLY = previousPdfOnly;
}
